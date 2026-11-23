import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { makeDelegate, makePatient, makeProduct, place, receive, setPerms } from './fixtures';

const users = inject('testUsers');

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

const daysAgo = async (c: Client, n: number) =>
  (await c.query('select (public.cairo_today() - $1::int)::text as d', [n])).rows[0].d as string;

async function setup(c: Client, name = 'Zz Full Arch Patient') {
  await actAs(c, users.organizer);
  const implant = await makeProduct(c);
  const lot = await receive(c, implant, 20, 'FAC');
  const delegate = await makeDelegate(c, 'Zz Full Arch Delegate');
  const patient = await makePatient(c, name);
  const placedOn = await daysAgo(c, 60);
  const placeAt = (tooth: number, forPatient = patient) =>
    place(c, { patient: forPatient, tooth, product: implant, lot, delegate, supervisor: users.organizer, placedOn });
  return { patient, delegate, placedOn, placeAt };
}

/** Cases are written by the definers of 0143; until then, as postgres. Returns to the organizer. */
async function makeCase(c: Client, patient: string, arch: string, opts: { closed?: boolean } = {}) {
  await asPostgres(c);
  const { rows } = await c.query(
    `insert into public.full_arch_cases (company_id, patient_id, arch, configuration, closed_at, close_reason)
     select p.company_id, p.id, $2, 'all_on_4', $3::timestamptz, $4 from public.patients p where p.id = $1
     returning id`,
    [patient, arch, opts.closed ? new Date().toISOString() : null, opts.closed ? 'Patient moved away' : null],
  );
  await actAs(c, users.organizer);
  return rows[0].id as string;
}

async function linkSites(c: Client, caseId: string, sites: string[]) {
  await asPostgres(c);
  await c.query('update public.implant_sites set case_id = $1 where id = any($2::uuid[])', [caseId, sites]);
  await actAs(c, users.organizer);
}

const addRestoration = async (c: Client, patient: string, a: { stage: string; type: string; sites: string[]; teeth?: number[] }) =>
  (await c.query(
    `select public.add_restoration(p_patient => $1, p_stage => $2, p_type => $3, p_sites => $4::uuid[],
       p_teeth => $5::smallint[], p_fitted_on => public.cairo_today(), p_retention => 'screw',
       p_material => null, p_delegate => null, p_supervisor => null, p_course => null, p_remake_reason => null,
       p_notes => null) as id`,
    [patient, a.stage, a.type, a.sites, a.teeth ?? null],
  )).rows[0].id as string;

const caseOf = async (c: Client, restoration: string) =>
  (await c.query('select case_id from public.restorations where id = $1', [restoration])).rows[0].case_id as string | null;

const UPPER_SPAN = [15, 14, 13, 12, 11, 21, 22, 23, 24, 25];

describe('full-arch cases: schema', () => {
  it('one open case per arch', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const first = await makeCase(c, s.patient, 'upper');
      await refused(c, () => makeCase(c, s.patient, 'upper'), /full_arch_cases_one_open/);
      await makeCase(c, s.patient, 'lower');

      await asPostgres(c);
      await c.query(`update public.full_arch_cases set closed_at = now(), close_reason = 'Treatment changed' where id = $1`, [first]);
      const again = await makeCase(c, s.patient, 'upper');
      expect(again).not.toBe(first);
      await makeCase(c, s.patient, 'upper', { closed: true });
    });
  });

  it('refuses values outside the settled lists', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await refused(c, () => makeCase(c, s.patient, 'both'), /check/);
      const kase = await makeCase(c, s.patient, 'upper');
      await asPostgres(c);
      await refused(c, () => c.query(`update public.full_arch_cases set configuration = 'all_on_5' where id = $1`, [kase]), /check/);
      await refused(c, () => c.query(`update public.full_arch_cases set name = repeat('x', 61) where id = $1`, [kase]), /check/);
      const stage = (stage: string, extra = '') =>
        c.query(`insert into public.full_arch_stages (company_id, case_id, stage, done_on${extra ? ', ' + extra.split('=')[0] : ''})
                 select company_id, id, $2, public.cairo_today()${extra ? ', ' + extra.split('=')[1] : ''}
                 from public.full_arch_cases where id = $1`, [kase, stage]);
      await refused(c, () => stage('delivery'), /check/);
      await refused(c, () => stage('scan', "lab='Lab A'"), /check/);
      await refused(c, () => stage('lab_design', 'passive_fit=true'), /check/);
      await stage('lab_design', "lab='Lab A'");
      await stage('try_in', 'passive_fit=true');
      await refused(c, () => stage('try_in'), /full_arch_stages_case_id_stage_key/);
    });
  });

  it('authenticated may not write the tables or the case links directly', async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(`
        select t || ':' || p as name from unnest(array['public.full_arch_cases', 'public.full_arch_stages']) t,
          unnest(array['INSERT', 'UPDATE', 'DELETE']) p where has_table_privilege('authenticated', t, p)
        union all
        select t || '.case_id:' || p from unnest(array['public.implant_sites', 'public.restorations']) t,
          unnest(array['INSERT', 'UPDATE']) p where has_column_privilege('authenticated', t, 'case_id', p)`);
      expect(rows).toEqual([]);
      const read = await c.query(`select has_table_privilege('authenticated', 'public.full_arch_cases', 'SELECT') as a,
        has_table_privilege('authenticated', 'public.full_arch_stages', 'SELECT') as b`);
      expect(read.rows[0]).toEqual({ a: true, b: true });
    });
  });
});

describe('full-arch cases: restoration link trigger', () => {
  it('links a new restoration on the case arch, not a single crown elsewhere', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const sites = [];
      for (const tooth of [15, 12, 22, 25]) sites.push(await s.placeAt(tooth));
      const other = await s.placeAt(36);
      const kase = await makeCase(c, s.patient, 'upper');
      await linkSites(c, kase, sites);

      const temp = await addRestoration(c, s.patient, { stage: 'temporary', type: 'full_arch', sites, teeth: UPPER_SPAN });
      expect(await caseOf(c, temp)).toBe(kase);
      const crown = await addRestoration(c, s.patient, { stage: 'final', type: 'single_crown', sites: [other] });
      expect(await caseOf(c, crown)).toBeNull();
    });
  });

  it('does not link to a closed case', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const sites = [];
      for (const tooth of [15, 12, 22, 25]) sites.push(await s.placeAt(tooth));
      const kase = await makeCase(c, s.patient, 'upper', { closed: true });
      await linkSites(c, kase, sites);
      const temp = await addRestoration(c, s.patient, { stage: 'temporary', type: 'full_arch', sites, teeth: UPPER_SPAN });
      expect(await caseOf(c, temp)).toBeNull();
    });
  });
});

describe('full-arch cases: reading', () => {
  it('staff read, delegates do not', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const kase = await makeCase(c, s.patient, 'upper');
      await asPostgres(c);
      await c.query(`insert into public.full_arch_stages (company_id, case_id, stage, done_on)
                     select company_id, id, 'scan', public.cairo_today() from public.full_arch_cases where id = $1`, [kase]);
      const seen = async () => ({
        cases: (await c.query('select count(*)::int as n from public.full_arch_cases where id = $1', [kase])).rows[0].n,
        stages: (await c.query('select count(*)::int as n from public.full_arch_stages where case_id = $1', [kase])).rows[0].n,
      });

      await actAs(c, users.organizer);
      expect(await seen()).toEqual({ cases: 1, stages: 1 });
      await actAs(c, users.delegate);
      expect(await seen()).toEqual({ cases: 0, stages: 0 });
      await setPerms(c, users.viewer, { inventory: 'edit' });
      await actAs(c, users.viewer);
      expect(await seen()).toEqual({ cases: 0, stages: 0 });
    });
  });
});

describe('full-arch cases: existing functions', () => {
  it('remove_placement and delete_patient work with a case; the case goes with the patient', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const a = await s.placeAt(15);
      const b = await s.placeAt(25);
      const kase = await makeCase(c, s.patient, 'upper');
      await linkSites(c, kase, [a, b]);
      await asPostgres(c);
      await c.query(`insert into public.full_arch_stages (company_id, case_id, stage, done_on)
                     select company_id, id, 'scan', public.cairo_today() from public.full_arch_cases where id = $1`, [kase]);
      await actAs(c, users.organizer);

      await c.query('select public.remove_placement(p_site => $1, p_reason => $2)', [a, 'Wrong tooth chosen']);
      expect((await c.query('select count(*)::int as n from public.implant_sites where id = $1', [a])).rows[0].n).toBe(0);

      await c.query('select public.delete_patient($1)', [s.patient]);
      await asPostgres(c);
      expect((await c.query('select count(*)::int as n from public.full_arch_cases where id = $1', [kase])).rows[0].n).toBe(0);
      expect((await c.query('select count(*)::int as n from public.full_arch_stages where case_id = $1', [kase])).rows[0].n).toBe(0);
    });
  });

  it('previous app calls work unchanged on a patient with a case', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const kase = await makeCase(c, s.patient, 'lower');
      const planned = (await c.query('select public.plan_implant($1, 14::smallint) as id', [s.patient])).rows[0].id;
      expect(planned).toBeTruthy();
      const site = await s.placeAt(36);
      const crown = await addRestoration(c, s.patient, { stage: 'final', type: 'single_crown', sites: [site] });
      expect(await caseOf(c, crown)).toBeNull();
      const linked = (await c.query('select case_id from public.implant_sites where id = $1', [site])).rows[0].case_id;
      expect(linked).toBeNull();
      expect(kase).toBeTruthy();
    });
  });
});

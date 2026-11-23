import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, actAsBound, asPostgres } from './helpers';
import {
  insertSelfAuthUser, makeDelegate, makePatient, makeProduct, pendingLogin, place, receive, setPerms,
} from './fixtures';

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

// ── 0143: the case functions ──────────────────────────────────────────────────────────────────────────
const ARCH_RULE = /An implant must be this patient's, on this arch, and not in another case\./;
const OPEN_RULE = /This arch already has an open full-arch case\./;
const CLOSED = /This case is closed\./;
const STALE = /Someone else changed this case\. Reload and try again\./;

const one = async (c: Client, sql: string, params: unknown[] = []) => Object.values((await c.query(sql, params)).rows[0] ?? {})[0];

const createCase = async (c: Client, patient: string, arch: string, sites: string[], configuration = 'all_on_4') =>
  (await one(c, `select public.create_full_arch_case(p_patient => $1, p_arch => $2, p_configuration => $3,
    p_name => 'Zz case', p_notes => '', p_sites => $4::uuid[])`, [patient, arch, configuration, sites])) as string;

/** Reads as postgres, then acts as `user` again (the organizer by default). */
async function asOwnerRead<T>(c: Client, fn: () => Promise<T>, user = users.organizer): Promise<T> {
  await asPostgres(c);
  const out = await fn();
  await actAs(c, user);
  return out;
}

const stamp = (c: Client, kase: string) =>
  asOwnerRead(c, async () => (await c.query('select updated_at::text as at from public.full_arch_cases where id = $1', [kase])).rows[0].at as string);
const caseRow = (c: Client, kase: string) =>
  asOwnerRead(c, async () => (await c.query('select * from public.full_arch_cases where id = $1', [kase])).rows[0]);
const sitesOf = (c: Client, kase: string) =>
  asOwnerRead(c, async () =>
    (await c.query('select id from public.implant_sites where case_id = $1 order by tooth', [kase])).rows.map((r) => r.id as string));

const closeCase = async (c: Client, kase: string, reason: string) =>
  c.query('select public.close_full_arch_case(p_case => $1, p_reason => $2, p_updated_at => $3)', [kase, reason, await stamp(c, kase)]);
const reopenCase = async (c: Client, kase: string) =>
  c.query('select public.reopen_full_arch_case(p_case => $1, p_updated_at => $2)', [kase, await stamp(c, kase)]);
const setSites = async (c: Client, kase: string, sites: string[]) =>
  c.query('select public.set_case_sites(p_case => $1, p_sites => $2::uuid[], p_updated_at => $3)', [kase, sites, await stamp(c, kase)]);
const updateCase = async (c: Client, kase: string, a: { configuration: string; name?: string; notes?: string; at?: string }) =>
  c.query(`select public.update_full_arch_case(p_case => $1, p_configuration => $2, p_name => $3, p_notes => $4,
    p_updated_at => $5)`, [kase, a.configuration, a.name ?? '', a.notes ?? '', a.at ?? await stamp(c, kase)]);
const recordStage = (c: Client, kase: string,
  a: { stage: string; on: string; lab?: string | null; fit?: boolean | null; occlusion?: string | null }) =>
  c.query(`select public.record_case_stage(p_case => $1, p_stage => $2, p_done_on => $3::date, p_lab => $4,
    p_passive_fit => $5, p_occlusion => $6, p_notes => 'Zz stage')`,
  [kase, a.stage, a.on, a.lab ?? null, a.fit ?? null, a.occlusion ?? null]);
const planAt = async (c: Client, patient: string, tooth: number) =>
  (await one(c, 'select public.plan_implant($1, $2::smallint)', [patient, tooth])) as string;

describe('full-arch cases: functions (0143)', () => {
  it('create groups planned and placed implants; membership rules', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const planned = await planAt(c, s.patient, 15);
      const placed = await s.placeAt(25);
      const lower = await s.placeAt(36);
      const kase = await createCase(c, s.patient, 'upper', [planned, placed]);
      expect(await sitesOf(c, kase)).toEqual([planned, placed]);
      expect(await caseRow(c, kase)).toMatchObject({ arch: 'upper', configuration: 'all_on_4', name: 'Zz case', closed_at: null });

      await refused(c, () => createCase(c, s.patient, 'lower', [lower, planned]), ARCH_RULE);
      await refused(c, () => createCase(c, s.patient, 'upper', []), OPEN_RULE);
      await refused(c, () => setSites(c, kase, [planned, lower]), ARCH_RULE);
      // Another patient's implant, and an implant already in another open case.
      const other = await makePatient(c, 'Zz Full Arch Other');
      const otherSite = await s.placeAt(16, other);
      await refused(c, () => setSites(c, kase, [otherSite]), ARCH_RULE);
      const lowerCase = await createCase(c, s.patient, 'lower', [lower]);
      await refused(c, () => createCase(c, other, 'lower', [lower]), ARCH_RULE);
      await refused(c, () => setSites(c, lowerCase, [planned]), ARCH_RULE);
      await refused(c, () => createCase(c, s.patient, 'both', []), /Choose the arch\./);
      await refused(c, () => createCase(c, other, 'upper', [], 'all_on_5'), /Choose the configuration\./);
      // A removed implant may not join.
      const cancelled = await planAt(c, s.patient, 14);
      await c.query('select public.cancel_planned_implant($1)', [cancelled]);
      await refused(c, () => setSites(c, kase, [placed, cancelled]), ARCH_RULE);

      // set_case_sites replaces the membership.
      await setSites(c, kase, [placed]);
      expect(await sitesOf(c, kase)).toEqual([placed]);
      expect(await sitesOf(c, lowerCase)).toEqual([lower]);
    });
  });

  it('new case takes implants from a closed case', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const a1 = await s.placeAt(15);
      const a2 = await s.placeAt(25);
      const first = await createCase(c, s.patient, 'upper', [a1, a2]);
      await closeCase(c, first, 'Changed plan');
      const second = await createCase(c, s.patient, 'upper', [a1, a2]);
      expect(await sitesOf(c, second)).toEqual([a1, a2]);
      expect(await sitesOf(c, first)).toEqual([]);
    });
  });

  it('close needs a reason and blocks edits; reopen clears it', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await s.placeAt(15);
      const kase = await createCase(c, s.patient, 'upper', [site]);
      await refused(c, () => closeCase(c, kase, '  '), /Give a reason to close the case\./);
      await closeCase(c, kase, 'Patient moved away');
      const closed = await caseRow(c, kase);
      expect(closed.close_reason).toBe('Patient moved away');
      expect(closed.closed_at).not.toBeNull();

      await refused(c, () => setSites(c, kase, [site]), CLOSED);
      await refused(c, () => recordStage(c, kase, { stage: 'scan', on: s.placedOn }), CLOSED);
      await refused(c, () => c.query(`select public.clear_case_stage(p_case => $1, p_stage => 'scan')`, [kase]), CLOSED);
      await refused(c, () => closeCase(c, kase, 'Again'), CLOSED);
      await refused(c, () => updateCase(c, kase, { configuration: 'all_on_6' }), CLOSED);

      await reopenCase(c, kase);
      expect(await caseRow(c, kase)).toMatchObject({ closed_at: null, close_reason: null });
      await recordStage(c, kase, { stage: 'scan', on: s.placedOn });

      await closeCase(c, kase, 'Changed plan');
      await createCase(c, s.patient, 'upper', []);
      await refused(c, () => reopenCase(c, kase), OPEN_RULE);
    });
  });

  it('optimistic concurrency', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const kase = await createCase(c, s.patient, 'upper', []);
      const at = await stamp(c, kase);
      await updateCase(c, kase, { configuration: 'all_on_6', name: ' Zz renamed ', notes: 'Zz notes', at });
      expect(await caseRow(c, kase)).toMatchObject({ configuration: 'all_on_6', name: 'Zz renamed', notes: 'Zz notes' });
      // now() is fixed inside the test transaction, so a stale stamp is an older one.
      const stale = '2000-01-01 00:00:00+00';
      await refused(c, () => updateCase(c, kase, { configuration: 'other', at: stale }), STALE);
      await refused(c, () => c.query('select public.set_case_sites(p_case => $1, p_sites => $2::uuid[], p_updated_at => $3)',
        [kase, [], stale]), STALE);
      await refused(c, () => c.query('select public.close_full_arch_case(p_case => $1, p_reason => $2, p_updated_at => $3)',
        [kase, 'Zz reason', stale]), STALE);
      await refused(c, () => c.query('select public.reopen_full_arch_case(p_case => $1, p_updated_at => $2)',
        [kase, stale]), STALE);
      await refused(c, () => c.query('select public.update_full_arch_case(p_case => $1, p_configuration => $2, p_name => $3, p_notes => $4, p_updated_at => null)',
        [kase, 'other', '', '']), STALE);
      await refused(c, () => updateCase(c, kase, { configuration: 'other', name: 'x'.repeat(61) }), /60 characters/);
    });
  });

  it('stages', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const planned = await planAt(c, s.patient, 15);
      const kase = await createCase(c, s.patient, 'upper', [planned]);
      await refused(c, () => recordStage(c, kase, { stage: 'scan', on: s.placedOn }),
        /Record a stage after an implant of the case is placed\./);

      const placed = await s.placeAt(25);
      await setSites(c, kase, [planned, placed]);
      const range = /The date must be between the first placement and today\./;
      const before = await daysAgo(c, 61);
      const tomorrow = await daysAgo(c, -1);
      await refused(c, () => recordStage(c, kase, { stage: 'scan', on: before }), range);
      await refused(c, () => recordStage(c, kase, { stage: 'scan', on: tomorrow }), range);
      await refused(c, () => recordStage(c, kase, { stage: 'delivery', on: s.placedOn }), /Choose the stage\./);
      await refused(c, () => recordStage(c, kase, { stage: 'scan', on: s.placedOn, lab: 'Lab A' }), /lab/i);
      await refused(c, () => recordStage(c, kase, { stage: 'lab_design', on: s.placedOn, fit: true }), /try-in/i);

      const today = await daysAgo(c, 0);
      const tenAgo = await daysAgo(c, 10);
      const fiveAgo = await daysAgo(c, 5);
      await recordStage(c, kase, { stage: 'scan', on: s.placedOn });
      await recordStage(c, kase, { stage: 'lab_design', on: today, lab: ' Lab A ' });
      await recordStage(c, kase, { stage: 'try_in', on: tenAgo, fit: false, occlusion: 'High on 25' });
      const stages = () => asOwnerRead(c, async () => (await c.query(`select stage, done_on::text, lab, passive_fit, occlusion, notes
        from public.full_arch_stages where case_id = $1 order by stage`, [kase])).rows);
      expect((await stages()).find((r) => r.stage === 'try_in')).toMatchObject({ passive_fit: false, occlusion: 'High on 25' });
      await recordStage(c, kase, { stage: 'try_in', on: fiveAgo, fit: true, occlusion: '' });
      expect(await stages()).toEqual([
        { stage: 'lab_design', done_on: today, lab: 'Lab A', passive_fit: null, occlusion: null, notes: 'Zz stage' },
        { stage: 'scan', done_on: s.placedOn, lab: null, passive_fit: null, occlusion: null, notes: 'Zz stage' },
        { stage: 'try_in', done_on: fiveAgo, lab: null, passive_fit: true, occlusion: null, notes: 'Zz stage' },
      ]);

      await c.query(`select public.clear_case_stage(p_case => $1, p_stage => 'lab_design')`, [kase]);
      expect((await stages()).map((r) => r.stage)).toEqual(['scan', 'try_in']);
    });
  });

  it('restoration link rules', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const sites = [];
      for (const tooth of [15, 12, 22, 25]) sites.push(await s.placeAt(tooth));
      const lowerSite = await s.placeAt(36);
      const lowerCrown = await addRestoration(c, s.patient, { stage: 'final', type: 'single_crown', sites: [lowerSite] });
      const bridge = await addRestoration(c, s.patient, { stage: 'temporary', type: 'full_arch', sites, teeth: UPPER_SPAN });
      const kase = await createCase(c, s.patient, 'upper', sites);
      expect(await caseOf(c, bridge)).toBeNull();

      const link = (resto: string, k: string | null) =>
        c.query('select public.set_case_restoration(p_restoration => $1, p_case => $2)', [resto, k]);
      const restoRule = /A restoration in a case must be this patient's and on the case's arch\./;
      await refused(c, () => link(lowerCrown, kase), restoRule);
      const other = await makePatient(c, 'Zz Full Arch Other');
      const otherSite = await s.placeAt(14, other);
      const otherCrown = await addRestoration(c, other, { stage: 'final', type: 'single_crown', sites: [otherSite] });
      await refused(c, () => link(otherCrown, kase), restoRule);

      await link(bridge, kase);
      expect(await caseOf(c, bridge)).toBe(kase);
      await link(bridge, null);
      expect(await caseOf(c, bridge)).toBeNull();

      await link(bridge, kase);
      await closeCase(c, kase, 'Changed plan');
      await refused(c, () => link(bridge, null), CLOSED);
      await refused(c, () => link(lowerCrown, kase), CLOSED);
    });
  });

  it('permissions: View on Patients may not call the functions', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await s.placeAt(15);
      const kase = await createCase(c, s.patient, 'upper', [site]);
      const crown = await addRestoration(c, s.patient, { stage: 'final', type: 'single_crown', sites: [site] });
      const at = await stamp(c, kase);
      await actAs(c, users.viewer);
      const calls: Array<[string, unknown[]]> = [
        [`select public.create_full_arch_case($1, 'lower', 'all_on_4', '', '', '{}'::uuid[])`, [s.patient]],
        [`select public.update_full_arch_case($1, 'all_on_6', '', '', $2)`, [kase, at]],
        ['select public.set_case_sites($1, $2::uuid[], $3)', [kase, [], at]],
        ['select public.set_case_restoration($1, $2)', [crown, kase]],
        [`select public.record_case_stage($1, 'scan', public.cairo_today(), null, null, null, '')`, [kase]],
        [`select public.clear_case_stage($1, 'scan')`, [kase]],
        [`select public.close_full_arch_case($1, 'Zz', $2)`, [kase, at]],
        ['select public.reopen_full_arch_case($1, $2)', [kase, at]],
      ];
      for (const [sql, params] of calls) await refused(c, () => c.query(sql, params), /Patients/);
    });
  });

  it('company isolation', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await s.placeAt(15);
      const kase = await createCase(c, s.patient, 'upper', [site]);
      await recordStage(c, kase, { stage: 'scan', on: s.placedOn });
      const crown = await addRestoration(c, s.patient, { stage: 'final', type: 'single_crown', sites: [site] });
      const at = await stamp(c, kase);

      await asPostgres(c);
      await c.query("select set_config('request.jwt.claims', '', true)");
      const tag = Math.random().toString(36).slice(2, 8);
      const companyB = (await one(c, 'insert into public.companies (slug, name) values ($1, $2) returning id',
        [`zz-arch-${tag}`, 'Zz Arch B'])) as string;
      const email = `zz-arch-${tag}-admin@example.com`;
      await pendingLogin(c, email, { company: companyB, role: 'admin', fullName: 'Zz Arch admin' });
      const adminB = await insertSelfAuthUser(c, { email, companyId: companyB });
      await actAsBound(c, adminB, companyB);

      const patientB = (await one(c, `insert into public.patients (full_name) values ('Zz Arch B patient') returning id`)) as string;
      const kaseB = (await one(c,
        `select public.create_full_arch_case($1, 'upper', 'all_on_4', '', '', '{}'::uuid[])`, [patientB])) as string;
      const atB = (await one(c, 'select updated_at::text from public.full_arch_cases where id = $1', [kaseB])) as string;
      const calls: Array<[string, unknown[]]> = [
        [`select public.create_full_arch_case($1, 'lower', 'all_on_4', '', '', '{}'::uuid[])`, [s.patient]],
        [`select public.update_full_arch_case($1, 'all_on_6', '', '', $2)`, [kase, at]],
        ['select public.set_case_sites($1, $2::uuid[], $3)', [kase, [], at]],
        ['select public.set_case_sites($1, $2::uuid[], $3)', [kaseB, [site], atB]],
        ['select public.set_case_restoration($1, $2)', [crown, kaseB]],
        ['select public.set_case_restoration($1, null)', [crown]],
        [`select public.record_case_stage($1, 'scan', public.cairo_today(), null, null, null, '')`, [kase]],
        [`select public.clear_case_stage($1, 'scan')`, [kase]],
        [`select public.close_full_arch_case($1, 'Zz', $2)`, [kase, at]],
        ['select public.reopen_full_arch_case($1, $2)', [kase, at]],
      ];
      for (const [sql, params] of calls) await refused(c, () => c.query(sql, params), /./);

      await asPostgres(c);
      expect((await c.query('select closed_at, configuration from public.full_arch_cases where id = $1', [kase])).rows[0])
        .toEqual({ closed_at: null, configuration: 'all_on_4' });
      expect((await c.query('select case_id from public.implant_sites where id = $1', [site])).rows[0].case_id).toBe(kase);
      expect((await c.query('select count(*)::int as n from public.full_arch_stages where case_id = $1', [kase])).rows[0].n).toBe(1);
    });
  });

  it('history shows case changes and the restoration link', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const sites = [];
      for (const tooth of [15, 12, 22, 25]) sites.push(await s.placeAt(tooth));
      const kase = await createCase(c, s.patient, 'upper', sites);
      await recordStage(c, kase, { stage: 'scan', on: s.placedOn });
      const bridge = await addRestoration(c, s.patient, { stage: 'temporary', type: 'full_arch', sites, teeth: UPPER_SPAN });
      expect(await caseOf(c, bridge)).toBe(kase);

      await setPerms(c, users.viewer, { patients: 'view' });
      for (const user of [users.organizer, users.viewer]) {
        await actAs(c, user);
        const rows = (await c.query('select table_name, action, before, after from public.patient_history($1)', [s.patient])).rows;
        const tables = new Set(rows.map((r) => r.table_name));
        expect(tables.has('full_arch_cases')).toBe(true);
        expect(tables.has('full_arch_stages')).toBe(true);
        // The trigger's link stays in History, as an update of case_id only (the app labels it).
        const linked = rows.filter((r) => r.table_name === 'restorations' && r.action === 'UPDATE'
          && r.before?.case_id === null && r.after?.case_id === kase);
        expect(linked).toHaveLength(1);
      }
    });
  });
});

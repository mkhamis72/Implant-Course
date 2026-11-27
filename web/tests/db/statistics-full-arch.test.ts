import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, actAsBound, asPostgres } from './helpers';
import { insertSelfAuthUser, legacyFailure, makeDelegate, makePatient, pendingLogin, place, receive, setPerms } from './fixtures';

// Statistics for zygomatic and full-arch work (0146): the implant-level reader, the case-level reader, the
// planned-case count and the two export readers.

const users = inject('testUsers');
const ALL_EDIT = { patients: 'edit', schedule: 'edit', courses: 'edit', checklists: 'edit', inventory: 'edit', delegates: 'edit' } as const;
/** pg returns a date as local midnight: back to YYYY-MM-DD. */
const day = (d: Date | null) =>
  d && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const CASE_CODE = /^A-[A-HJ-NP-Z2-9]{6}$/;

const daysAgo = async (c: Client, n: number) =>
  (await c.query('select (public.cairo_today() - $1::int)::text as d', [n])).rows[0].d as string;

type Filters = { course?: string | null; from?: string | null; to?: string | null; delegate?: string | null; brand?: string | null; system?: string | null };
const args = (f: Filters) => [f.course ?? null, f.from ?? null, f.to ?? null, f.delegate ?? null, f.brand ?? null, f.system ?? null];

const READERS = ['implant_rehab_vars', 'analysis_full_arch_cases', 'research_export_implant_rehab', 'research_export_full_arch_cases'] as const;
const call = async (c: Client, reader: (typeof READERS)[number], f: Filters) =>
  c.query(`select * from public.${reader}($1, $2::date, $3::date, $4, $5, $6)`, args(f));
const rows = async (c: Client, reader: (typeof READERS)[number], f: Filters) => (await call(c, reader, f)).rows;
const planned = async (c: Client) =>
  (await c.query('select public.full_arch_planned_cases() as n')).rows[0].n as number;

/** A case written as postgres (the 0143 definers check things these fixtures don't need). */
async function makeCase(c: Client, patient: string, arch: string, configuration: string, closed = false) {
  const { rows: r } = await c.query(
    `insert into public.full_arch_cases (company_id, patient_id, arch, configuration, closed_at, close_reason)
     select p.company_id, p.id, $2, $3, $4::timestamptz, $5 from public.patients p where p.id = $1 returning id`,
    [patient, arch, configuration, closed ? '2026-01-10T22:30:00Z' : null, closed ? 'Zz secret close reason' : null]);
  return r[0].id as string;
}

/**
 * Patient P: an All-on-4 upper case (12, 22 conventional; 15, 25 tilted 30° distal; 25 placed earlier and failed)
 * with a final full-arch bridge over all four, one live and one voided bridge problem, a scan stage; and a
 * planned-only lower case. Patient Q: a closed All-on-6 upper case whose implant 16 moved to a newer "other" upper
 * case, which also holds a zygomatic implant at 14.
 */
async function setup(c: Client) {
  await setPerms(c, users.organizer, { ...ALL_EDIT, research: 'view' });
  await actAs(c, users.organizer);
  const before = await planned(c);
  const tag = Math.random().toString(36).slice(2, 8);
  const brand = `Zz Rehab ${tag}`;
  const prod = (await c.query(
    `insert into public.products (type, brand, system, diameter_mm, length_mm) values ('implant', $1, 'MD EXT', 4.0, 10) returning id`,
    [brand])).rows[0].id as string;
  const lot = await receive(c, prod, 20, `RH${tag}`);
  const delegate = await makeDelegate(c, 'Zz Rehab Delegate');
  const p = await makePatient(c, `Zz Rehab Patient P ${tag}`);
  const q = await makePatient(c, `Zz Rehab Patient Q ${tag}`);
  const on60 = await daysAgo(c, 60);
  const on100 = await daysAgo(c, 100);
  const at = (patient: string, tooth: number, placedOn = on60) =>
    place(c, { patient, tooth, product: prod, lot, delegate, supervisor: users.organizer, placedOn });
  const s12 = await at(p, 12);
  const s22 = await at(p, 22);
  const s15 = await at(p, 15);
  const s25 = await at(p, 25, on100);
  const z14 = await at(q, 14);
  const m16 = await at(q, 16);

  await asPostgres(c);
  const allOn4 = await makeCase(c, p, 'upper', 'all_on_4');
  const plannedCase = await makeCase(c, p, 'lower', 'all_on_6');
  const oldCase = await makeCase(c, q, 'upper', 'all_on_6', true);
  const otherCase = await makeCase(c, q, 'upper', 'other');
  await c.query(`update public.implant_sites set case_id = $1, implant_type = 'conventional' where id = any($2::uuid[])`, [allOn4, [s12, s22]]);
  await c.query(`update public.implant_sites set case_id = $1, implant_type = 'tilted', angulation_deg = 30,
    angulation_direction = 'distal', entry_point = 'Zz secret entry', trajectory = 'Zz secret trajectory'
    where id = any($2::uuid[])`, [allOn4, [s15, s25]]);
  await c.query(`update public.implant_sites set case_id = $1, implant_type = 'zygomatic', angulation_deg = 45,
    angulation_direction = 'palatal_lingual', anchorage = 'zygoma' where id = $2`, [otherCase, z14]);
  // Moved: first in the closed case, now in the newer one.
  await c.query('update public.implant_sites set case_id = $1 where id = $2', [oldCase, m16]);
  await c.query('update public.implant_sites set case_id = $1 where id = $2', [otherCase, m16]);
  await c.query(`insert into public.full_arch_stages (company_id, case_id, stage, done_on, notes)
    select company_id, id, 'scan', $2::date, 'Zz secret stage note' from public.full_arch_cases where id = $1`, [allOn4, on60]);

  await actAs(c, users.organizer);
  const bridge = (await c.query(
    `select public.add_restoration(p_patient => $1, p_stage => 'final', p_type => 'full_arch', p_sites => $2::uuid[],
       p_teeth => '{15,14,13,12,11,21,22,23,24,25}'::smallint[], p_fitted_on => public.cairo_today(), p_retention => 'screw', p_material => null, p_delegate => null,
       p_supervisor => null, p_course => null, p_remake_reason => null, p_notes => '') as id`,
    [p, [s12, s22, s15, s25]])).rows[0].id as string;
  await asPostgres(c);
  await c.query('update public.restorations set case_id = $1 where id = $2', [allOn4, bridge]);
  await actAs(c, users.organizer);
  const problem = async () => (await c.query(
    `select public.record_restoration_problem($1, public.cairo_today(), 'chipping', 'repaired', '') as id`, [bridge])).rows[0].id as string;
  await problem();
  const voided = await problem();
  await c.query('select public.void_restoration_problem($1, $2)', [voided, 'Entered twice']);
  await legacyFailure(c, s25, await daysAgo(c, 10), users.organizer);

  await actAs(c, users.organizer);
  return { brand, p, q, s12, s22, s15, s25, z14, m16, allOn4, plannedCase, oldCase, otherCase, bridge, on60, on100, before };
}

describe('implant_rehab_vars', () => {
  it('returns type, geometry and current case per implant of the filtered set', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const got = await rows(c, 'implant_rehab_vars', { brand: s.brand });
      const detail = (await c.query(
        'select site_id from public.implant_outcomes_detail(null, null, null, null, $1, null)', [s.brand])).rows.map((r) => r.site_id);
      expect(got.map((r) => r.site_id).sort()).toEqual([...detail].sort());
      const by = (id: string) => got.find((r) => r.site_id === id);
      expect(by(s.s12)).toEqual({ site_id: s.s12, implant_type: 'conventional', angulation_deg: null, angulation_direction: null,
        anchorage: null, case_id: s.allOn4, case_configuration: 'all_on_4' });
      expect(by(s.s25)).toMatchObject({ implant_type: 'tilted', angulation_deg: '30.0', angulation_direction: 'distal', case_id: s.allOn4 });
      expect(by(s.z14)).toMatchObject({ implant_type: 'zygomatic', anchorage: 'zygoma', case_id: s.otherCase, case_configuration: 'other' });
      expect(by(s.m16)).toMatchObject({ implant_type: 'conventional', case_id: s.otherCase, case_configuration: 'other' });
      expect(Object.keys(got[0]).sort()).toEqual(
        ['site_id', 'implant_type', 'angulation_deg', 'angulation_direction', 'anchorage', 'case_id', 'case_configuration'].sort());
    });
  });

  it('leaves case fields null for an implant in no case, and follows the filters', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await asPostgres(c);
      await c.query('update public.implant_sites set case_id = null where id = $1', [s.s12]);
      await actAs(c, users.organizer);
      const got = await rows(c, 'implant_rehab_vars', { brand: s.brand, from: s.on60, to: s.on60 });
      expect(got.map((r) => r.site_id)).not.toContain(s.s25);
      expect(got.find((r) => r.site_id === s.s12)).toMatchObject({ case_id: null, case_configuration: null });
    });
  });
});

describe('analysis_full_arch_cases', () => {
  it('one row per case with an implant in the set: not the planned case, not the emptied closed case', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const got = await rows(c, 'analysis_full_arch_cases', { brand: s.brand });
      expect(got.map((r) => r.case_id).sort()).toEqual([s.allOn4, s.otherCase].sort());
      const a = got.find((r) => r.case_id === s.allOn4)!;
      expect(a).toMatchObject({
        patient_id: s.p, arch: 'upper', configuration: 'all_on_4', closed_at: null,
        implants_placed: 4, implants_failed: 1, bridge_problems: 1,
      });
      expect(day(a.first_placed_on)).toBe(s.on100);
      expect(typeof a.file_no).toBe('string');
      expect(a.sites.map((x: { id: string }) => x.id).sort()).toEqual([s.s12, s.s22, s.s15, s.s25].sort());
      expect(a.sites.find((x: { id: string }) => x.id === s.s25)).toEqual({ id: s.s25, tooth: 25, state: 'failed' });
      expect(a.bridges).toHaveLength(1);
      expect(a.bridges[0]).toMatchObject({ id: s.bridge, type: 'full_arch', stage: 'final', ended_on: null });
      expect(a.bridges[0]).not.toHaveProperty('case_id');
      expect([...a.bridges[0].site_ids].sort()).toEqual([s.s12, s.s22, s.s15, s.s25].sort());
      expect(Object.keys(a).sort()).toEqual(['case_id', 'patient_id', 'file_no', 'arch', 'configuration', 'closed_at',
        'first_placed_on', 'implants_placed', 'implants_failed', 'bridge_problems', 'sites', 'bridges'].sort());
      const o = got.find((r) => r.case_id === s.otherCase)!;
      expect(o).toMatchObject({ implants_placed: 2, implants_failed: 0, bridge_problems: 0, bridges: [] });
    });
  });

  it('keeps every site of the case when the date filter covers only one of them', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const got = await rows(c, 'analysis_full_arch_cases', { brand: s.brand, from: s.on100, to: s.on100 });
      expect(got.map((r) => r.case_id)).toEqual([s.allOn4]);
      expect(got[0].sites).toHaveLength(4);
      expect(got[0]).toMatchObject({ implants_placed: 4, implants_failed: 1 });
    });
  });

  it('returns a closed case that still holds an implant', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await asPostgres(c);
      await c.query('update public.implant_sites set case_id = $1 where id = $2', [s.oldCase, s.m16]);
      await actAs(c, users.organizer);
      const got = await rows(c, 'analysis_full_arch_cases', { brand: s.brand });
      expect(got.map((r) => r.case_id).sort()).toEqual([s.allOn4, s.oldCase, s.otherCase].sort());
      expect(got.find((r) => r.case_id === s.oldCase)!.closed_at).not.toBeNull();
    });
  });
});

describe('full_arch_planned_cases', () => {
  it('counts open cases with no placed implant', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const before = s.before;
      expect(await planned(c)).toBe(before + 1);
      // Once an implant of the planned case is placed, it is no longer planned.
      await asPostgres(c);
      await c.query('update public.implant_sites set case_id = $1 where id = $2', [s.plannedCase, s.s12]);
      await actAs(c, users.organizer);
      expect(await planned(c)).toBe(before);
    });
  });
});

describe('export readers', () => {
  it('return case codes, stable across calls, and only the listed columns', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const imp1 = await call(c, 'research_export_implant_rehab', { brand: s.brand });
      expect(imp1.fields.map((f) => f.name)).toEqual(
        ['implant_code', 'implant_type', 'angulation_deg', 'angulation_direction', 'anchorage', 'case_code', 'case_configuration']);
      expect(imp1.rows).toHaveLength(6);
      const z = imp1.rows.find((r) => r.implant_type === 'zygomatic')!;
      expect(z.case_code).toMatch(CASE_CODE);
      expect(z.implant_code).toMatch(/^I-/);
      const cases1 = await call(c, 'research_export_full_arch_cases', { brand: s.brand });
      expect(cases1.fields.map((f) => f.name)).toEqual(['case_code', 'patient_code', 'arch', 'configuration', 'first_placed_on',
        'closed_on', 'scan_on', 'lab_design_on', 'try_in_on', 'implants_placed', 'implants_failed', 'bridge_problems', 'sites', 'bridges']);
      expect(cases1.rows).toHaveLength(2);
      for (const r of cases1.rows) {
        expect(r.case_code).toMatch(CASE_CODE);
        expect(r.patient_code).toMatch(/^P-/);
      }
      const a = cases1.rows.find((r) => r.configuration === 'all_on_4')!;
      expect([day(a.first_placed_on), day(a.scan_on)]).toEqual([s.on100, s.on60]);
      expect(a).toMatchObject({ arch: 'upper', closed_on: null, lab_design_on: null,
        try_in_on: null, implants_placed: 4, implants_failed: 1, bridge_problems: 1 });
      expect(a.sites).toHaveLength(4);
      expect(a.bridges).toHaveLength(1);
      expect(imp1.rows.filter((r) => r.case_configuration === 'all_on_4').every((r) => r.case_code === a.case_code)).toBe(true);
      const text = JSON.stringify([imp1.rows, cases1.rows]);
      expect(text).not.toMatch(/secret|Zz Rehab Patient/);

      const imp2 = await rows(c, 'research_export_implant_rehab', { brand: s.brand });
      const cases2 = await rows(c, 'research_export_full_arch_cases', { brand: s.brand });
      expect(imp2.map((r) => r.case_code).sort()).toEqual(imp1.rows.map((r) => r.case_code).sort());
      expect(cases2.map((r) => r.case_code).sort()).toEqual(cases1.rows.map((r) => r.case_code).sort());
    });
  });

  it('gives a closed case its Cairo closing date', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await asPostgres(c);
      await c.query('update public.implant_sites set case_id = $1 where id = $2', [s.oldCase, s.m16]);
      await actAs(c, users.organizer);
      const got = await rows(c, 'research_export_full_arch_cases', { brand: s.brand });
      // 2026-01-10 22:30 UTC is 2026-01-11 in Cairo.
      expect(day(got.find((r) => r.configuration === 'all_on_6')!.closed_on)).toBe('2026-01-11');
    });
  });
});

describe('gates', () => {
  const expectEmpty = async (c: Client, brand: string | null) => {
    for (const reader of READERS) expect(await rows(c, reader, { brand })).toEqual([]);
    expect(await planned(c)).toBe(0);
  };

  it('return nothing without Research view', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await setPerms(c, users.organizer, ALL_EDIT);
      await actAs(c, users.organizer);
      await expectEmpty(c, s.brand);
    });
  });

  it('return nothing without Patients view', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await setPerms(c, users.organizer, { research: 'view' });
      await actAs(c, users.organizer);
      await expectEmpty(c, s.brand);
    });
  });

  it("return nothing of another company's", async () => {
    await withTx(async (c) => {
      await setup(c);
      await asPostgres(c);
      await c.query("select set_config('request.jwt.claims', '', true)");
      const tag = Math.random().toString(36).slice(2, 8);
      const companyB = (await c.query('insert into public.companies (slug, name) values ($1, $2) returning id',
        [`zz-rehab-${tag}`, 'Zz Rehab B'])).rows[0].id as string;
      const email = `zz-rehab-${tag}-admin@example.com`;
      await pendingLogin(c, email, { company: companyB, role: 'admin', fullName: 'Zz Rehab admin' });
      const adminB = await insertSelfAuthUser(c, { email, companyId: companyB });
      await actAsBound(c, adminB, companyB);
      await expectEmpty(c, null);
    });
  });
});

describe('delete_patient', () => {
  it("clears the patient's full-arch case study codes", async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await rows(c, 'research_export_full_arch_cases', { brand: s.brand });
      const codes = async () => (await c.query(
        `select entity_id from app_private.research_codes where entity = 'full_arch_case' and entity_id = any($1::uuid[])`,
        [[s.allOn4, s.plannedCase, s.otherCase]])).rows.map((r) => r.entity_id as string);
      await asPostgres(c);
      expect((await codes()).sort()).toEqual([s.allOn4, s.otherCase].sort());
      await actAs(c, users.organizer);
      await c.query('select public.delete_patient($1)', [s.p]);
      await asPostgres(c);
      // P's case code is gone; Q's stays.
      expect(await codes()).toEqual([s.otherCase]);
    });
  });
});

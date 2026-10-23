import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { makeDelegate, makePatient, place, receive, setPerms } from './fixtures';

const users = inject('testUsers');
const ALL_EDIT = { patients: 'edit', schedule: 'edit', courses: 'edit', checklists: 'edit', inventory: 'edit', delegates: 'edit' } as const;
const READERS = ['implants', 'patients', 'visits', 'radiographs', 'complications', 'restorations', 'restoration_problems', 'grafts'] as const;
const CODE = /^P-[A-HJ-NP-Z2-9]{6}$/;

const daysAgo = async (c: Client, n: number) =>
  (await c.query('select (public.cairo_today() - $1::int)::text as d', [n])).rows[0].d as string;

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

type Filters = { course?: string | null; from?: string | null; to?: string | null; delegate?: string | null; brand?: string | null; system?: string | null };
const args = (f: Filters) => [f.course ?? null, f.from ?? null, f.to ?? null, f.delegate ?? null, f.brand ?? null, f.system ?? null];

const read = async (c: Client, table: (typeof READERS)[number], f: Filters) =>
  (await c.query(`select * from public.research_export_${table}($1, $2::date, $3::date, $4, $5, $6)`, args(f))).rows;

const code = async (c: Client, entity: string, id: string) =>
  (await c.query('select public.research_code($1, $2) as code', [entity, id])).rows[0].code as string;

/**
 * One patient (name, phone, email, address, file number and free text everywhere, all marked with a secret) with
 * implants at 34 and 36 of one brand, and one live and one voided row in every child table.
 */
async function setup(c: Client) {
  await actAs(c, users.organizer);
  const tag = Math.random().toString(36).slice(2, 8);
  const secret = `SECRET${tag}`;
  const brand = `Zz Export ${tag}`;
  const prod = (await c.query(
    `insert into public.products (type, brand, system, diameter_mm, length_mm) values ('implant', $1, 'MD EXT', 4.0, 10) returning id`,
    [brand])).rows[0].id as string;
  const lot = await receive(c, prod, 5, `EX${tag}`);
  const delegate = await makeDelegate(c, `Zz Export Delegate ${secret}`);
  const name = `Zz Export Patient ${secret}`;
  const patient = await makePatient(c, name);
  const placed = await daysAgo(c, 400);
  const a = await place(c, { patient, tooth: 36, product: prod, lot, delegate, supervisor: users.organizer, placedOn: placed });
  const b = await place(c, { patient, tooth: 34, product: prod, lot, delegate, supervisor: users.organizer, placedOn: placed });

  await asPostgres(c);
  const course = (await c.query('select course_id from public.implant_sites where id = $1', [a])).rows[0].course_id as string;
  const phone = `0100${Math.floor(Math.random() * 1e7)}`;
  const fileNo = `ZF${tag}`;
  await c.query(
    `update public.patients set file_no = $2, phone = $3, email = $4, address = $5, dob = '1980-06-15', sex = 'female' where id = $1`,
    [patient, fileNo, phone, `${secret}@example.com`, `${secret} street`]);
  await c.query(
    `update public.medical_history set allergies = $2, medications = $2, other_conditions = $2, notes = $2,
       smoking = 'current', cigarettes_per_day = 10, diabetes_status = 'yes', hba1c = 7.1, hba1c_date = $3::date - 30
     where patient_id = $1`, [patient, secret, placed]);
  await c.query(`update public.implant_sites set notes = $2, graft = $2, technique = 'guided', torque_ncm = 35, isq = 70,
    bone_type = 'D2', impression_type = 'digital_scan', impression_taken_on = $3 where id = $1`, [a, secret, placed]);
  await c.query(`insert into public.implant_surgery (site_id, placement_timing, flap, healing) values ($1, 'delayed', 'crestal', 'submerged')`, [a]);
  await c.query(`insert into public.implant_grafts (site_id, procedure, timing, material, product, notes)
    values ($1, 'gbr', 'simultaneous', 'xenograft', $2, $2)`, [a, secret]);

  const visit = async (voided: boolean) => (await c.query(
    `insert into public.implant_followups (site_id, date, check_type, outcome, attendance, visit_key, pain_score, notes,
       patient_concerns, recommended_treatment, voided_at, voided_reason)
     values ($1, $2::date + 180, $3, 'ok', 'attended', 'month_6', 1, $3, $3, $3, $4, $5) returning id`,
    [a, placed, secret, voided ? new Date().toISOString() : null, voided ? secret : ''])).rows[0].id as string;
  const liveVisit = await visit(false);
  const voidVisit = await visit(true);

  const xray = async (voided: boolean) => (await c.query(
    `insert into public.radiographs (patient_id, taken_on, type, purpose, teeth, link, notes, voided_at, voided_reason)
     values ($1, $2::date + 10, 'periapical', 'baseline', '{34,36}', $3, $4, $5, $6) returning id`,
    [patient, placed, `https://example.com/${secret}`, secret, voided ? new Date().toISOString() : null, voided ? secret : ''])).rows[0].id as string;
  const liveXray = await xray(false);
  const voidXray = await xray(true);
  await c.query(`insert into public.radiograph_bone_levels (radiograph_id, site_id, mesial_mm, distal_mm) values ($1, $2, 0.5, 1.0)`, [liveXray, a]);
  await c.query(`insert into public.radiograph_bone_levels (radiograph_id, site_id, mesial_mm, distal_mm) values ($1, $2, 0.7, 1.2)`, [voidXray, a]);

  const complication = async (voided: boolean) => (await c.query(
    `insert into public.implant_complications (site_id, category, type, other_type, noticed_on, severity, treatment, notes,
       voided_at, voided_reason)
     values ($1, 'biological', 'other', $2, $3::date + 100, 'mild', $2, $2, $4, $5) returning id`,
    [a, secret, placed, voided ? new Date().toISOString() : null, voided ? secret : ''])).rows[0].id as string;
  const liveComplication = await complication(false);
  await complication(true);

  const restoration = async (voided: boolean) => {
    const id = (await c.query(
      `insert into public.restorations (patient_id, stage, type, teeth, fitted_on, retention, material, delegate_id,
         supervisor_id, notes, ended_on, end_kind, end_reason, voided_at, voided_reason)
       values ($1, 'final', 'single_crown', '{36}', $2::date + 200, 'screw', 'zirconia', $3, $4, $5, $2::date + 300,
         'remade', $5, $6, $7) returning id`,
      [patient, placed, delegate, users.organizer, secret, voided ? new Date().toISOString() : null, voided ? secret : ''])).rows[0].id as string;
    await c.query('insert into public.restoration_sites (restoration_id, site_id) values ($1, $2)', [id, a]);
    return id;
  };
  const liveRestoration = await restoration(false);
  const voidRestoration = await restoration(true);
  const problem = async (voided: boolean) => c.query(
    `insert into public.restoration_problems (restoration_id, noticed_on, type, action, notes, voided_at, voided_reason)
     values ($1, $2::date + 250, 'chipping', 'repaired', $3, $4, $5)`,
    [liveRestoration, placed, secret, voided ? new Date().toISOString() : null, voided ? secret : '']);
  await problem(false);
  await problem(true);

  return {
    tag, secret, brand, prod, delegate, course, name, phone, fileNo, patient, placed, a, b, liveVisit, voidVisit, liveXray,
    voidXray, liveComplication, liveRestoration, voidRestoration,
  };
}

describe('research_code', () => {
  it('is stable per entity, different between entities, and uses the study-code alphabet', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const other = await makePatient(c, 'Zz Export Other');
      await actAs(c, users.admin);
      const first = await code(c, 'patient', s.patient);
      expect(first).toMatch(CODE);
      expect(await code(c, 'patient', s.patient)).toBe(first);
      const second = await code(c, 'patient', other);
      expect(second).toMatch(CODE);
      expect(second).not.toBe(first);
      expect(await code(c, 'implant', s.a)).toMatch(/^I-[A-HJ-NP-Z2-9]{6}$/);
      expect(await code(c, 'restoration', s.liveRestoration)).toMatch(/^R-[A-HJ-NP-Z2-9]{6}$/);
      expect(await code(c, 'delegate', s.delegate)).toMatch(/^D-[A-HJ-NP-Z2-9]{6}$/);
      expect(await code(c, 'supervisor', users.organizer)).toMatch(/^S-[A-HJ-NP-Z2-9]{6}$/);
      await refused(c, () => code(c, 'radiograph', s.patient), /Unknown/);
    });
  });
});

describe('research export: access', () => {
  it('needs Research view and Patients view', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await asPostgres(c);
      await setPerms(c, users.target, { research: 'view', schedule: 'view' });
      await actAs(c, users.target);
      await refused(c, () => code(c, 'patient', s.patient), /Research export needs View on Patients/);
      await refused(
        c, () => c.query(`select public.log_research_export('csv', '{}'::jsonb, '{}'::jsonb)`),
        /Research export needs View on Patients/,
      );
      for (const t of READERS) expect(await read(c, t, { brand: s.brand })).toEqual([]);

      // Patients edit without a Research row: every reader is empty.
      await asPostgres(c);
      await setPerms(c, users.target, ALL_EDIT);
      await actAs(c, users.target);
      for (const t of READERS) expect(await read(c, t, { brand: s.brand })).toEqual([]);
      await refused(c, () => code(c, 'patient', s.patient), /permission/);

      // A delegate login: nothing either.
      await actAs(c, users.delegate);
      for (const t of READERS) expect(await read(c, t, { brand: s.brand })).toEqual([]);

      // Both: rows.
      await asPostgres(c);
      await setPerms(c, users.target, { ...ALL_EDIT, research: 'view' });
      await actAs(c, users.target);
      expect((await read(c, 'implants', { brand: s.brand })).length).toBe(2);
    });
  });
});

describe('research export: readers', () => {
  it('exports the same implant set as implant_outcomes_detail, with the same outcome columns', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await actAs(c, users.admin);
      for (const f of [{}, { brand: s.brand }, { delegate: s.delegate }, { brand: 'Zz none' }] as Filters[]) {
        const detail = (await c.query(
          `select * from public.implant_outcomes_detail($1, $2::date, $3::date, $4, $5, $6)`, args(f))).rows;
        const exported = await read(c, 'implants', f);
        expect(exported.length).toBe(detail.length);
        const expected = new Map<string, Record<string, unknown>>();
        for (const d of detail) expected.set(await code(c, 'implant', d.site_id), d);
        for (const row of exported) {
          const d = expected.get(row.implant_code);
          expect(d).toBeDefined();
          expect(row.patient_code).toBe(await code(c, 'patient', d!.patient_id as string));
          for (const col of ['tooth', 'placed_on', 'loaded_on', 'last_contact', 'follow_up_days', 'event', 'event_on',
            'event_time_unknown', 'at_loading', 'year_1', 'year_2', 'year_3', 'year_5', 'latest_grade', 'latest_grade_on',
            'latest_grade_reason', 'ungraded_later', 'biological_complications', 'mechanical_complications', 'version',
            'brand', 'system']) {
            expect(row[col], col).toEqual(d![col]);
          }
        }
      }
    });
  });

  it('returns placement, product, surgery and patient risk factors as coded values', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await actAs(c, users.admin);
      const [a] = (await read(c, 'implants', { brand: s.brand })).filter((r) => r.tooth === 36);
      expect(a).toMatchObject({
        implant_code: await code(c, 'implant', s.a), patient_code: await code(c, 'patient', s.patient), jaw: 'mandible',
        technique: 'guided', torque_ncm: '35.0', isq: '70.0', bone_type: 'D2', impression_type: 'digital_scan',
        diameter_mm: '4.00', length_mm: '10.0', placing_delegate_code: await code(c, 'delegate', s.delegate),
        supervisor_code: await code(c, 'supervisor', users.organizer), placement_timing: 'delayed', flap: 'crestal',
        healing: 'submerged', failure_type: null, failed_on: null,
      });

      // The course as a stable C- code (never the raw id).
      const courseCode = await code(c, 'course', s.course);
      expect(courseCode).toMatch(/^C-[A-HJ-NP-Z2-9]{6}$/);
      expect(await code(c, 'course', s.course)).toBe(courseCode);
      expect(a.course_code).toBe(courseCode);
      expect(a).not.toHaveProperty('course_id');

      // Failure type and date are exported; the reason and notes are not.
      await asPostgres(c);
      await c.query(`update public.implant_sites set state = 'failed', failure_type = 'lost', failure_reason = 'other',
        failure_notes = 'x', failed_on = $2::date + 50 where id = $1`, [s.a, s.placed]);
      await actAs(c, users.admin);
      const [failed] = (await read(c, 'implants', { brand: s.brand })).filter((r) => r.tooth === 36);
      const failedOn = (await c.query(`select ($1::date + 50) as d`, [s.placed])).rows[0].d;
      expect(failed).toMatchObject({ failure_type: 'lost', failed_on: failedOn });
      expect(failed).not.toHaveProperty('failure_reason');
      expect(failed).not.toHaveProperty('failure_notes');
      const patients = await read(c, 'patients', { brand: s.brand });
      expect(patients).toHaveLength(1);
      const ageAt = (await c.query(`select date_part('year', age($1::date, '1980-06-15'::date))::int as y`, [s.placed])).rows[0].y;
      expect(patients[0]).toMatchObject({
        patient_code: await code(c, 'patient', s.patient), sex: 'female', age_at_first_placement: ageAt, smoking: 'current',
        cigarettes_per_day: 10, diabetes_status: 'yes', hba1c: '7.1',
      });
      expect(patients[0]).not.toHaveProperty('dob');
    });
  });

  it('leaves out voided visits, X-rays, complications, restorations and restoration problems', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await actAs(c, users.admin);
      const f = { brand: s.brand };
      expect(await read(c, 'visits', f)).toHaveLength(1);
      expect(await read(c, 'complications', f)).toHaveLength(1);
      const restorations = await read(c, 'restorations', f);
      expect(restorations.map((r) => r.restoration_code)).toEqual([await code(c, 'restoration', s.liveRestoration)]);
      expect(restorations[0]).toMatchObject({ stage: 'final', type: 'single_crown', teeth: [36], end_kind: 'remade' });
      expect(await read(c, 'restoration_problems', f)).toHaveLength(1);
      expect(await read(c, 'grafts', f)).toHaveLength(1);
    });
  });

  it('lists only the exported implants under a restoration', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await actAs(c, users.organizer);
      const otherBrand = `${s.brand} Other`;
      const prod = (await c.query(
        `insert into public.products (type, brand, system, diameter_mm, length_mm) values ('implant', $1, 'MD EXT', 4.0, 10) returning id`,
        [otherBrand])).rows[0].id as string;
      const lot = await receive(c, prod, 2, `EXO${s.tag}`);
      const outside = await place(c, { patient: s.patient, tooth: 35, product: prod, lot, delegate: s.delegate, supervisor: users.organizer, placedOn: s.placed });
      await asPostgres(c);
      const bridge = (await c.query(
        `insert into public.restorations (patient_id, stage, type, teeth, fitted_on) values ($1, 'final', 'bridge', '{34,35}', $2::date + 200) returning id`,
        [s.patient, s.placed])).rows[0].id as string;
      await c.query('insert into public.restoration_sites (restoration_id, site_id) values ($1, $2), ($1, $3)', [bridge, s.b, outside]);

      await actAs(c, users.admin);
      const bridgeCode = await code(c, 'restoration', bridge);
      const [row] = (await read(c, 'restorations', { brand: s.brand })).filter((r) => r.restoration_code === bridgeCode);
      expect(row.implant_codes).toEqual([await code(c, 'implant', s.b)]);
      const [all] = (await read(c, 'restorations', {})).filter((r) => r.restoration_code === bridgeCode);
      expect(all.implant_codes).toEqual([await code(c, 'implant', s.b), await code(c, 'implant', outside)]);
    });
  });

  it('gives one X-ray row per exported implant on its teeth, empty levels when not measured', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await actAs(c, users.admin);
      const rows = await read(c, 'radiographs', { brand: s.brand });
      expect(rows).toHaveLength(2);
      const byTooth = Object.fromEntries(rows.map((r) => [r.tooth, r]));
      expect(byTooth[36]).toMatchObject({ implant_code: await code(c, 'implant', s.a), mesial_mm: '0.5', distal_mm: '1.0', purpose: 'baseline' });
      expect(byTooth[34]).toMatchObject({ implant_code: await code(c, 'implant', s.b), mesial_mm: null, distal_mm: null });
    });
  });

  it('never returns names, contact details, file numbers, raw ids, dob or free text', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await actAs(c, users.admin);
      const forbidden = [s.secret, s.name, s.phone, s.fileNo, s.patient, s.a, s.b, s.delegate, s.liveRestoration,
        s.liveVisit, s.liveXray, s.liveComplication, s.course, users.organizer, '1980-06-15'];
      const seen: string[] = [];
      const scan = (v: unknown): void => {
        if (v === null || v === undefined) return;
        if (Array.isArray(v)) return v.forEach(scan);
        if (v instanceof Date) return void seen.push(v.toISOString());
        if (typeof v === 'object') return Object.values(v as object).forEach(scan);
        seen.push(String(v));
      };
      for (const t of READERS) {
        const rows = await read(c, t, { brand: s.brand });
        expect(rows.length, t).toBeGreaterThan(0);
        rows.forEach(scan);
      }
      for (const value of seen) for (const bad of forbidden) expect(value).not.toContain(bad);
    });
  });
});

describe('assign_research_codes', () => {
  const assign = (c: Client, f: Filters) =>
    c.query('select public.assign_research_codes($1, $2::date, $3::date, $4, $5, $6)', args(f));
  const count = async (c: Client) => {
    await asPostgres(c);
    return Number((await c.query('select count(*) as n from app_private.research_codes')).rows[0].n);
  };

  it('stores every code the readers need up front, so the readers insert none', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      for (const f of [{ brand: s.brand }, { brand: s.brand, course: s.course, delegate: s.delegate }] as Filters[]) {
        const before = await count(c);
        await actAs(c, users.admin);
        await assign(c, f);
        const assigned = await count(c);
        if (!f.course) expect(assigned).toBeGreaterThan(before);
        await actAs(c, users.admin);
        for (const t of READERS) expect((await read(c, t, f)).length, t).toBeGreaterThan(0);
        // the filter's course and delegate codes too (the files name them by code)
        await code(c, 'course', s.course);
        await code(c, 'delegate', s.delegate);
        expect(await count(c)).toBe(assigned);
      }
    });
  });

  it('needs Research view and Patients view', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await asPostgres(c);
      await setPerms(c, users.target, { research: 'view', schedule: 'view' });
      await actAs(c, users.target);
      await refused(c, () => assign(c, { brand: s.brand }), /Research export needs View on Patients/);
      await asPostgres(c);
      await setPerms(c, users.target, ALL_EDIT);
      await actAs(c, users.target);
      await refused(c, () => assign(c, { brand: s.brand }), /permission/);
    });
  });
});

describe('research export log', () => {
  it('is written by log_research_export, read by admins only, and never changed', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      await setPerms(c, users.target, { patients: 'view', research: 'view' });
      await actAs(c, users.target);
      const id = (await c.query(
        `select public.log_research_export('xlsx', '{"brand":"X"}'::jsonb, '{"implants":2}'::jsonb) as id`)).rows[0].id as string;
      expect((await c.query('select * from public.research_exports')).rows).toEqual([]);
      await refused(c, () => c.query(`select public.log_research_export('pdf', '{}'::jsonb, '{}'::jsonb)`), /research_exports_format_check|format/);
      await refused(c, () => c.query(`insert into public.research_exports (format) values ('csv')`), /permission denied/);

      await actAs(c, users.admin);
      const rows = (await c.query('select exported_by, format, filters, row_counts from public.research_exports where id = $1', [id])).rows;
      expect(rows).toEqual([{ exported_by: users.target, format: 'xlsx', filters: { brand: 'X' }, row_counts: { implants: 2 } }]);
      await refused(c, () => c.query(`update public.research_exports set format = 'csv' where id = $1`, [id]), /permission denied/);
      await refused(c, () => c.query('delete from public.research_exports where id = $1', [id]), /permission denied/);
    });
  });
});

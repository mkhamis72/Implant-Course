import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { makeDelegate, makePatient, place, receive, setPerms } from './fixtures';

const users = inject('testUsers');
const ALL_EDIT = { patients: 'edit', schedule: 'edit', courses: 'edit', checklists: 'edit', inventory: 'edit', delegates: 'edit' } as const;
const READERS = ['implants', 'visits', 'radiographs'] as const;

const daysAgo = async (c: Client, n: number) =>
  (await c.query('select (public.cairo_today() - $1::int)::text as d', [n])).rows[0].d as string;

const read = async (c: Client, table: (typeof READERS)[number], brand: string) =>
  (await c.query(`select * from public.analysis_${table}(null, null, null, null, $1, null)`, [brand])).rows;

/** One patient (dob 1980-06-15) with implants at 36 and 13 of a unique brand, placed 400 days ago. */
async function setup(c: Client) {
  await actAs(c, users.organizer);
  const tag = Math.random().toString(36).slice(2, 8);
  const brand = `Zz Analysis ${tag}`;
  const prod = (await c.query(
    `insert into public.products (type, brand, system, diameter_mm, length_mm) values ('implant', $1, 'MD EXT', 4.0, 10) returning id`,
    [brand])).rows[0].id as string;
  const lot = await receive(c, prod, 5, `AN${tag}`);
  const delegate = await makeDelegate(c, `Zz Analysis Delegate ${tag}`);
  const patient = await makePatient(c, `Zz Analysis Patient ${tag}`);
  const placed = await daysAgo(c, 400);
  const a = await place(c, { patient, tooth: 36, product: prod, lot, delegate, supervisor: users.organizer, placedOn: placed });
  const b = await place(c, { patient, tooth: 13, product: prod, lot, delegate, supervisor: users.organizer, placedOn: placed });
  await asPostgres(c);
  await c.query(`update public.patients set dob = '1980-06-15', sex = 'female' where id = $1`, [patient]);
  return { brand, patient, placed, a, b };
}

const xray = async (c: Client, patient: string, placed: string, day: number, purpose: string, extra: Record<string, unknown> = {}) =>
  (await c.query(
    `insert into public.radiographs (patient_id, taken_on, type, purpose, teeth, voided_at)
     values ($1, $2::date + $3::int, 'periapical', $4, '{36}', $5) returning id`,
    [patient, placed, day, purpose, extra.voided ? new Date().toISOString() : null])).rows[0].id as string;
const level = (c: Client, radiograph: string, site: string, mesial: number, distal: number) =>
  c.query('insert into public.radiograph_bone_levels (radiograph_id, site_id, mesial_mm, distal_mm) values ($1, $2, $3, $4)',
    [radiograph, site, mesial, distal]);

describe('analysis readers (0078)', () => {
  it('analysis_implants returns the implant set of implant_outcomes_detail', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await actAs(c, users.admin);
      const rows = await read(c, 'implants', s.brand);
      const detail = (await c.query(
        `select site_id, event, follow_up_days, latest_grade from public.implant_outcomes_detail(null, null, null, null, $1, null)
         order by site_id`, [s.brand])).rows;
      const mine = rows.map((r) => ({ site_id: r.site_id, event: r.event, follow_up_days: r.follow_up_days, latest_grade: r.latest_grade }))
        .sort((x, y) => x.site_id.localeCompare(y.site_id));
      expect(mine).toEqual(detail.sort((x, y) => x.site_id.localeCompare(y.site_id)));
      expect(rows.map((r) => r.tooth).sort()).toEqual([13, 36]);
    });
  });

  it('derives membrane, sinus, age and the final restoration', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await c.query(`insert into public.implant_surgery (site_id, grafting_performed) values ($1, 'yes')`, [s.a]);
      await c.query(`insert into public.implant_grafts (site_id, procedure, timing, material, membrane)
        values ($1, 'gbr', 'simultaneous', 'xenograft', 'resorbable')`, [s.a]);
      const restoration = async (stage: string, day: number) => {
        const id = (await c.query(
          `insert into public.restorations (patient_id, stage, type, teeth, fitted_on, retention, material)
           values ($1, $2, 'single_crown', '{36}', $3::date + $4::int, 'screw', 'zirconia') returning id`,
          [s.patient, stage, s.placed, day])).rows[0].id as string;
        await c.query('insert into public.restoration_sites (restoration_id, site_id) values ($1, $2)', [id, s.a]);
      };
      await restoration('temporary', 100);
      await restoration('final', 200);
      await actAs(c, users.admin);
      let rows = await read(c, 'implants', s.brand);
      const at = (tooth: number) => rows.find((r) => r.tooth === tooth)!;
      const age = (await c.query(`select extract(year from age($1::date, '1980-06-15'::date))::int as y`, [s.placed])).rows[0].y;
      expect(at(36)).toMatchObject({ membrane_used: 'yes', sinus_procedure: 'no', grafting_performed: 'yes', age_at_placement: age, sex: 'female' });
      expect(at(36).final_restoration_on).not.toBeNull();
      expect(at(13)).toMatchObject({ membrane_used: null, sinus_procedure: null, final_restoration_on: null });

      await asPostgres(c);
      await c.query(`insert into public.implant_grafts (site_id, procedure, timing, material, membrane)
        values ($1, 'sinus_lateral', 'simultaneous', 'xenograft', 'none')`, [s.a]);
      await c.query(`insert into public.implant_surgery (site_id, grafting_performed) values ($1, 'no')`, [s.b]);
      await actAs(c, users.admin);
      rows = await read(c, 'implants', s.brand);
      expect(at(36).sinus_procedure).toBe('yes');
      expect(at(13)).toMatchObject({ membrane_used: 'no', sinus_procedure: 'no' });
    });
  });

  it('analysis_visits summarizes probing and bleeding per visit', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const visit = (day: number, attendance: string, f: Record<string, unknown>, voided = false) => c.query(
        `insert into public.implant_followups (site_id, date, check_type, outcome, attendance, probing_mesial, probing_buccal,
           probing_distal, probing_lingual, bop_mesial, bop_buccal, bop_distal, bop_lingual, isq, voided_at)
         values ($1, $2::date + $3::int, 'check', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [s.a, s.placed, day, attendance === 'attended' ? 'ok' : null, attendance, f.pm ?? null, f.pb ?? null, f.pd ?? null,
         f.pl ?? null, f.bm ?? null, f.bb ?? null, f.bd ?? null, f.bl ?? null, f.isq ?? null, voided ? new Date().toISOString() : null]);
      await visit(30, 'attended', { pm: 3, pb: 5, pl: 2, bm: 'no', bb: 'yes', isq: 72 });
      await visit(90, 'attended', { pm: 2, bm: 'no', bb: 'no', bd: 'no', bl: 'no' });
      await visit(180, 'attended', {});
      await visit(200, 'did_not_attend', {});
      await visit(250, 'attended', { pm: 9 }, true);
      await actAs(c, users.admin);
      const rows = await read(c, 'visits', s.brand);
      expect(rows.map((r) => [r.days_since_placement, r.attendance, r.probing_max === null ? null : Number(r.probing_max), r.bop_any]))
        .toEqual([[30, 'attended', 5, 'yes'], [90, 'attended', 2, 'no'], [180, 'attended', null, null], [200, 'did_not_attend', null, null]]);
      expect(Number(rows[0].isq)).toBe(72);
    });
  });

  it('analysis_radiographs measures bone change against the visit_grades baseline', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const base = await xray(c, s.patient, s.placed, 10, 'baseline');
      await level(c, base, s.a, 0.2, 0.4);
      const follow = await xray(c, s.patient, s.placed, 365, 'follow_up');
      await level(c, follow, s.a, 0.9, 0.6);
      await xray(c, s.patient, s.placed, 380, 'follow_up');
      await xray(c, s.patient, s.placed, -5, 'planning');
      const voided = await xray(c, s.patient, s.placed, 390, 'follow_up', { voided: true });
      await level(c, voided, s.a, 3, 3);
      await actAs(c, users.admin);
      const rows = (await read(c, 'radiographs', s.brand)).filter((r) => r.site_id === s.a);
      expect(rows.map((r) => [r.days_since_placement, r.is_baseline, r.bone_change_mm === null ? null : Number(r.bone_change_mm),
        r.mesial_mm === null ? null : Number(r.mesial_mm)]))
        .toEqual([[10, true, null, 0.2], [365, false, 0.7, 0.9], [380, false, null, null]]);
    });
  });

  it('needs Research view and Patients view', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await xray(c, s.patient, s.placed, 10, 'baseline');
      await asPostgres(c);
      await setPerms(c, users.target, ALL_EDIT);
      await actAs(c, users.target);
      for (const t of READERS) expect(await read(c, t, s.brand)).toEqual([]);

      await asPostgres(c);
      await setPerms(c, users.target, { research: 'view', schedule: 'view' });
      await actAs(c, users.target);
      for (const t of READERS) expect(await read(c, t, s.brand)).toEqual([]);

      await actAs(c, users.delegate);
      for (const t of READERS) expect(await read(c, t, s.brand)).toEqual([]);

      await asPostgres(c);
      await setPerms(c, users.target, { ...ALL_EDIT, research: 'view' });
      await actAs(c, users.target);
      expect(await read(c, 'implants', s.brand)).toHaveLength(2);
      expect(await read(c, 'radiographs', s.brand)).toHaveLength(1);
    });
  });
});

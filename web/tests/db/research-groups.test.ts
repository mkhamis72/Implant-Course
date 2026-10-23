import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { enroll, makeCourse, makeDelegate, makePatient, place, receive, setPerms } from './fixtures';

const users = inject('testUsers');
const ALL_EDIT = { patients: 'edit', schedule: 'edit', courses: 'edit', checklists: 'edit', inventory: 'edit', delegates: 'edit' } as const;

const daysAgo = async (c: Client, n: number) =>
  (await c.query('select (public.cairo_today() - $1::int)::text as d', [n])).rows[0].d as string;

type Filters = { course?: string | null; from?: string | null; to?: string | null; delegate?: string | null; brand?: string | null; system?: string | null };
const args = (f: Filters) => [f.course ?? null, f.from ?? null, f.to ?? null, f.delegate ?? null, f.brand ?? null, f.system ?? null];

const groups = async (c: Client, f: Filters = {}) =>
  (await c.query(
    `select site_id, technique, bone_type, smoking, diabetes_status, periodontitis_history
     from public.implant_outcomes_groups($1, $2::date, $3::date, $4, $5, $6)`, args(f))).rows;

const detailIds = async (c: Client, f: Filters = {}) =>
  (await c.query(
    `select site_id from public.implant_outcomes_detail($1, $2::date, $3::date, $4, $5, $6)`, args(f))).rows.map((r) => r.site_id as string);

/** Two implants on two patients: A (technique guided, D2, history smoking/yes/no) and B (free hand, no bone type, no history row). */
async function setup(c: Client) {
  await actAs(c, users.organizer);
  const tag = Math.random().toString(36).slice(2, 8);
  const brand = `Zz Groups ${tag}`;
  const prod = (await c.query(
    `insert into public.products (type, brand, system, diameter_mm, length_mm) values ('implant', $1, 'MD EXT', 4.0, 10) returning id`, [brand])).rows[0].id as string;
  const lot = await receive(c, prod, 5, `RG${tag}`);
  const d = await makeDelegate(c, 'Zz Groups Delegate');
  const course = await makeCourse(c);
  await enroll(c, course, d);
  const pA = await makePatient(c, 'Zz Groups Patient A');
  const pB = await makePatient(c, 'Zz Groups Patient B');
  const placed = await daysAgo(c, 300);
  const a = await place(c, { patient: pA, tooth: 36, product: prod, lot, delegate: d, supervisor: users.organizer, placedOn: placed, course, technique: 'guided' });
  const b = await place(c, { patient: pB, tooth: 46, product: prod, lot, delegate: d, supervisor: users.organizer, placedOn: placed, course, technique: 'free_hand' });
  await asPostgres(c);
  await c.query(`update public.implant_sites set bone_type = 'D2' where id = $1`, [a]);
  await c.query(
    `insert into public.medical_history (patient_id, smoking, diabetes_status, periodontitis_history) values ($1, 'former', 'yes', null)
     on conflict (patient_id) do update set smoking = 'former', diabetes_status = 'yes', periodontitis_history = null`, [pA]);
  await c.query(`delete from public.medical_history where patient_id = $1`, [pB]);
  await actAs(c, users.admin);
  return { brand, a, b, d, course, placed };
}

describe('implant_outcomes_groups', () => {
  it('returns the same implants as implant_outcomes_detail, ordered by site_id', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      for (const f of [{}, { brand: s.brand }, { delegate: s.d, course: s.course }, { from: s.placed, to: s.placed }]) {
        const got = (await groups(c, f)).map((r) => r.site_id as string);
        expect([...got].sort()).toEqual([...(await detailIds(c, f))].sort());
        expect(got).toEqual([...got].sort());
      }
      expect((await groups(c, { brand: s.brand })).map((r) => r.site_id).sort()).toEqual([s.a, s.b].sort());
      expect(await groups(c, { brand: `${s.brand} none` })).toEqual([]);
    });
  });

  it('takes technique and bone type from implant_sites and risk factors from medical_history', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const rows = await groups(c, { brand: s.brand });
      expect(rows.find((r) => r.site_id === s.a)).toEqual({
        site_id: s.a, technique: 'guided', bone_type: 'D2', smoking: 'former', diabetes_status: 'yes', periodontitis_history: null,
      });
    });
  });

  it('passes nulls through: no history row, no bone type', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const rows = await groups(c, { brand: s.brand });
      expect(rows.find((r) => r.site_id === s.b)).toEqual({
        site_id: s.b, technique: 'free_hand', bone_type: null, smoking: null, diabetes_status: null, periodontitis_history: null,
      });
    });
  });

  it('needs Research view and Patients view; admins always read', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await actAs(c, users.admin);
      expect(await groups(c, { brand: s.brand })).toHaveLength(2);

      await setPerms(c, users.target, ALL_EDIT);
      await actAs(c, users.target);
      expect(await groups(c, { brand: s.brand })).toEqual([]);

      await setPerms(c, users.target, { ...ALL_EDIT, research: 'view' });
      await actAs(c, users.target);
      expect(await groups(c, { brand: s.brand })).toHaveLength(2);

      await setPerms(c, users.target, { research: 'view', schedule: 'view' });
      await actAs(c, users.target);
      expect(await groups(c, { brand: s.brand })).toEqual([]);

      await actAs(c, users.delegate);
      expect(await groups(c, { brand: s.brand })).toEqual([]);
    });
  });
});

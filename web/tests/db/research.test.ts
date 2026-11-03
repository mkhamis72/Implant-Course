import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { enroll, makeCourse, makeDelegate, makePatient, pendingLogin, place, receive, setPerms } from './fixtures';

const users = inject('testUsers');
const ALL_EDIT = { patients: 'edit', schedule: 'edit', courses: 'edit', checklists: 'edit', inventory: 'edit', delegates: 'edit' } as const;

const daysAgo = async (c: Client, n: number) =>
  (await c.query('select (public.cairo_today() - $1::int)::text as d', [n])).rows[0].d as string;

async function product(c: Client, brand: string, system: string): Promise<string> {
  const { rows } = await c.query(
    `insert into public.products (type, brand, system, diameter_mm, length_mm) values ('implant', $1, $2, 4.0, 10) returning id`,
    [brand, system],
  );
  return rows[0].id;
}

type Filters = { course?: string | null; from?: string | null; to?: string | null; delegate?: string | null; brand?: string | null; system?: string | null };
const args = (f: Filters) => [f.course ?? null, f.from ?? null, f.to ?? null, f.delegate ?? null, f.brand ?? null, f.system ?? null];

const implants = async (c: Client, f: Filters = {}) =>
  (await c.query(
    `select site_id, patient_id, tooth, course_id, placed_on::text, version, placing_delegate_id, placing_delegate,
            brand, system, product_id, patient_name, file_no
     from public.implant_outcomes_detail($1, $2::date, $3::date, $4, $5, $6)`, args(f))).rows;

const crowns = async (c: Client, f: Filters = {}) =>
  (await c.query(
    `select restoration_id, patient_id, type, teeth, remade, problems, version, patient_name, file_no
     from public.crown_outcomes_detail($1, $2::date, $3::date, $4, $5, $6)`, args(f))).rows;

const restore = async (c: Client, patient: string, sites: string[], teeth: number[], fittedOn: string) =>
  (await c.query(
    `select public.add_restoration(p_patient => $1, p_stage => 'final', p_type => $2, p_sites => $3::uuid[],
       p_teeth => $4::smallint[], p_fitted_on => $5::date, p_retention => null, p_material => null, p_delegate => null,
       p_supervisor => null, p_course => null, p_remake_reason => null, p_notes => '') as id`,
    [patient, sites.length > 1 ? 'bridge' : 'single_crown', sites, teeth, fittedOn],
  )).rows[0].id as string;

/**
 * Two implants on one patient: A (brand A, system "PSK-MDK · PSK Micro", delegate 1, course 1, placed 400 days ago) and
 * B (brand B, system "MD EXT", delegate 2, course 2, placed 300 days ago).
 */
async function setup(c: Client) {
  await actAs(c, users.organizer);
  const tag = Math.random().toString(36).slice(2, 8);
  const brandA = `Zz Research A ${tag}`;
  const brandB = `Zz Research B ${tag}`;
  const prodA = await product(c, brandA, 'PSK-MDK · PSK Micro');
  const prodB = await product(c, brandB, 'MD EXT');
  const lotA = await receive(c, prodA, 5, `RA${tag}`);
  const lotB = await receive(c, prodB, 5, `RB${tag}`);
  const d1 = await makeDelegate(c, 'Zz Research Delegate One');
  const d2 = await makeDelegate(c, 'Zz Research Delegate Two');
  const course1 = await makeCourse(c);
  const course2 = await makeCourse(c);
  await enroll(c, course1, d1);
  await enroll(c, course2, d2);
  const patient = await makePatient(c, 'Zz Research Patient');
  const placedA = await daysAgo(c, 400);
  const placedB = await daysAgo(c, 300);
  const a = await place(c, { patient, tooth: 36, product: prodA, lot: lotA, delegate: d1, supervisor: users.organizer, placedOn: placedA, course: course1 });
  const b = await place(c, { patient, tooth: 37, product: prodB, lot: lotB, delegate: d2, supervisor: users.organizer, placedOn: placedB, course: course2 });
  const fileNo = (await c.query('select file_no from public.patients where id = $1', [patient])).rows[0].file_no as string;
  return { brandA, brandB, prodA, prodB, d1, d2, course1, course2, patient, placedA, placedB, a, b, fileNo };
}

const ids = (rows: { site_id: string }[]) => rows.map((r) => r.site_id);

describe('research permission', () => {
  it('a new organizer has no Research row; Research is None, View or Edit (0073)', async () => {
    await withTx(async (c) => {
      await pendingLogin(c, 'zz-research-new@example.com');
      const { rows } = await c.query(
        `insert into auth.users (id, email) values (gen_random_uuid(), 'zz-research-new@example.com') returning id`,
      );
      const perms = await c.query(`select area from public.user_permissions where user_id = $1`, [rows[0].id]);
      expect(perms.rows.map((r) => r.area)).not.toContain('research');

      await actAs(c, users.admin);
      await c.query(`select public.set_user_permissions($1, '{"research": "view", "patients": "view"}'::jsonb)`, [users.target]);
      await asPostgres(c);
      const saved = await c.query('select area, level from public.user_permissions where user_id = $1 order by area', [users.target]);
      expect(saved.rows).toEqual([{ area: 'patients', level: 'view' }, { area: 'research', level: 'view' }]);

      await actAs(c, users.admin);
      await c.query(`select public.set_user_permissions($1, '{"research": "edit"}'::jsonb)`, [users.target]);
      await asPostgres(c);
      const edit = await c.query('select area, level from public.user_permissions where user_id = $1', [users.target]);
      expect(edit.rows).toEqual([{ area: 'research', level: 'edit' }]);
    });
  });

  it('readers need Research view and Patients view; admins always read', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const crown = await restore(c, s.patient, [s.a], [36], await daysAgo(c, 200));

      await actAs(c, users.admin);
      expect(ids(await implants(c, { brand: s.brandA }))).toEqual([s.a]);
      expect((await crowns(c, { brand: s.brandA })).map((r) => r.restoration_id)).toEqual([crown]);

      // Patients edit, no Research row: nothing.
      await setPerms(c, users.target, ALL_EDIT);
      await actAs(c, users.target);
      expect(await implants(c, { brand: s.brandA })).toEqual([]);
      expect(await crowns(c, { brand: s.brandA })).toEqual([]);

      // Research view: rows.
      await setPerms(c, users.target, { ...ALL_EDIT, research: 'view' });
      await actAs(c, users.target);
      expect(ids(await implants(c, { brand: s.brandA }))).toEqual([s.a]);
      expect((await crowns(c, { brand: s.brandA })).map((r) => r.restoration_id)).toEqual([crown]);

      // Research view without Patients view: the 5a readers return nothing.
      await setPerms(c, users.target, { research: 'view', schedule: 'view' });
      await actAs(c, users.target);
      expect(await implants(c, { brand: s.brandA })).toEqual([]);
      expect(await crowns(c, { brand: s.brandA })).toEqual([]);

      // A delegate login never reads them.
      await actAs(c, users.delegate);
      expect(await implants(c, { brand: s.brandA })).toEqual([]);
    });
  });
});

describe('implant_outcomes_detail', () => {
  it('adds delegate, product and patient columns to implant_outcomes', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await actAs(c, users.admin);
      const [row] = await implants(c, { brand: s.brandA });
      expect(row).toMatchObject({
        site_id: s.a, patient_id: s.patient, tooth: 36, course_id: s.course1, placed_on: s.placedA,
        placing_delegate_id: s.d1, placing_delegate: 'Zz Research Delegate One', brand: s.brandA,
        system: 'PSK-MDK · PSK Micro', product_id: s.prodA, patient_name: 'Zz Research Patient', file_no: s.fileNo,
      });
      const base = (await c.query(`select * from public.implant_outcomes(null, null, null) where site_id = $1`, [s.a])).rows[0];
      const detail = (await c.query(
        `select * from public.implant_outcomes_detail(null, null, null, null, null, null) where site_id = $1`, [s.a])).rows[0];
      expect(detail).toMatchObject(base);
    });
  });

  it('filters by delegate, brand, system, course and placement date', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await actAs(c, users.admin);
      const ours = async (f: Filters) => ids(await implants(c, f)).filter((id) => id === s.a || id === s.b);

      expect(await ours({})).toEqual([s.a, s.b]);
      expect(await ours({ delegate: s.d1 })).toEqual([s.a]);
      expect(await ours({ delegate: s.d2 })).toEqual([s.b]);
      expect(await ours({ brand: s.brandB })).toEqual([s.b]);
      expect(await ours({ brand: 'Zz Research' })).toEqual([]);
      expect(ids(await implants(c, { brand: s.brandA, system: 'PSK-MDK · PSK Micro' }))).toEqual([s.a]);
      expect(ids(await implants(c, { brand: s.brandA, system: 'MD EXT' }))).toEqual([]);
      expect(await ours({ system: 'MD EXT' })).toEqual([s.b]);
      expect(await ours({ system: 'PSK-MDK' })).toEqual([]);
      expect(await ours({ course: s.course1 })).toEqual([s.a]);
      expect(await ours({ course: s.course2 })).toEqual([s.b]);
      expect(await ours({ from: s.placedB })).toEqual([s.b]);
      expect(await ours({ to: s.placedA })).toEqual([s.a]);
      expect(await ours({ from: s.placedA, to: s.placedB, delegate: s.d2, brand: s.brandB, system: 'MD EXT', course: s.course2 }))
        .toEqual([s.b]);
    });
  });

  it('an implant with no product appears only without a brand or system filter', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await asPostgres(c);
      // Only a removed implant may lack a product (implant_sites_placed_details).
      await c.query(`update public.implant_sites set state = 'removed', product_id = null where id = $1`, [s.b]);
      await actAs(c, users.admin);
      const row = (await implants(c, { delegate: s.d2 })).find((r) => r.site_id === s.b);
      expect(row).toMatchObject({ product_id: null, brand: null, system: null });
      expect(ids(await implants(c, { delegate: s.d2, brand: s.brandB }))).toEqual([]);
      expect(ids(await implants(c, { delegate: s.d2, system: 'MD EXT' }))).toEqual([]);
    });
  });
});

describe('crown_outcomes_detail', () => {
  it('lists a crown once when at least one of its implants matches (bridge on two implants, one matching)', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const fitted = await daysAgo(c, 200);
      const bridge = await restore(c, s.patient, [s.a, s.b], [36, 37], fitted);
      await actAs(c, users.admin);

      const byBrandA = await crowns(c, { brand: s.brandA });
      expect(byBrandA.map((r) => r.restoration_id)).toEqual([bridge]);
      expect(byBrandA[0]).toMatchObject({ type: 'bridge', patient_name: 'Zz Research Patient', file_no: s.fileNo });
      expect((await crowns(c, { brand: s.brandB })).map((r) => r.restoration_id)).toEqual([bridge]);
      expect((await crowns(c, { delegate: s.d1 })).filter((r) => r.restoration_id === bridge)).toHaveLength(1);
      expect((await crowns(c, { delegate: s.d2 })).filter((r) => r.restoration_id === bridge)).toHaveLength(1);

      const base = (await c.query(`select * from public.crown_outcomes(null, null, null) where restoration_id = $1`, [bridge])).rows[0];
      const detail = (await c.query(
        `select * from public.crown_outcomes_detail(null, null, null, null, null, null) where restoration_id = $1`, [bridge])).rows;
      expect(detail).toHaveLength(1);
      expect(detail[0]).toMatchObject(base);
    });
  });

  it('leaves out crowns whose implants are all outside the filter; filters apply to the implants', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const fitted = await daysAgo(c, 200);
      const onA = await restore(c, s.patient, [s.a], [36], fitted);
      const onB = await restore(c, s.patient, [s.b], [37], fitted);
      await actAs(c, users.admin);
      const ours = async (f: Filters) =>
        (await crowns(c, f)).map((r) => r.restoration_id).filter((id) => id === onA || id === onB).sort();

      expect(await ours({})).toEqual([onA, onB].sort());
      expect(await ours({ brand: s.brandA })).toEqual([onA]);
      expect(await ours({ system: 'MD EXT' })).toEqual([onB]);
      expect(await ours({ delegate: s.d2 })).toEqual([onB]);
      expect(await ours({ course: s.course1 })).toEqual([onA]);
      // Dates are placement dates of the implants, not fitting dates.
      expect(await ours({ from: s.placedB })).toEqual([onB]);
      expect(await ours({ to: s.placedA })).toEqual([onA]);
    });
  });
});

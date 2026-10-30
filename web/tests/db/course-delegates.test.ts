import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { enroll, makeCourse, makeDelegate, makePatient, makeProduct, receive, setPerms } from './fixtures';

const users = inject('testUsers');

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

const NOT_ENROLLED = /Zz Outsider is not enrolled in this course/;

async function setup(c: Client) {
  await actAs(c, users.organizer);
  const implant = await makeProduct(c);
  const lot = await receive(c, implant, 10, 'CDG');
  const member = await makeDelegate(c, 'Zz Member');
  const outsider = await makeDelegate(c, 'Zz Outsider');
  const course = await makeCourse(c);
  await enroll(c, course, member);
  const patient = await makePatient(c, 'Zz Course Delegates Patient');
  return { implant, lot, member, outsider, course, patient };
}
type Setup = Awaited<ReturnType<typeof setup>>;

const placeAs = (c: Client, s: Setup, placing: string, assisting: string | null, tooth = 36) =>
  c.query(
    `select public.place_implant_v3(
       p_patient => $1, p_tooth => $2::smallint, p_product => $3, p_lot => $4, p_placed_on => public.cairo_today(),
       p_placing_delegate => $5, p_supervisor => $6, p_assisting_delegate => $7, p_graft => '', p_notes => '',
       p_slot => null, p_technique => null, p_course => $8) as id`,
    [s.patient, tooth, s.implant, s.lot, placing, users.organizer, assisting, s.course],
  ).then((r) => r.rows[0].id as string);

const correct = (c: Client, site: string, a: { placing: string; assisting?: string | null; course: string; notes?: string }) =>
  c.query(
    `select public.correct_placement_v2(p_site => $1, p_placed_on => placed_on, p_placing_delegate => $2,
       p_assisting_delegate => $3, p_supervisor => supervisor_id, p_course => $4, p_graft => '', p_notes => $5)
     from public.implant_sites where id = $1`,
    [site, a.placing, a.assisting ?? null, a.course, a.notes ?? ''],
  );

const addRestoration = (c: Client, s: Setup, site: string, delegate: string | null, course: string | null) =>
  c.query(
    `select public.add_restoration(p_patient => $1, p_stage => 'final', p_type => 'single_crown', p_sites => $2::uuid[],
       p_teeth => null, p_fitted_on => public.cairo_today(), p_retention => null, p_material => null, p_delegate => $3,
       p_supervisor => null, p_course => $4, p_remake_reason => null, p_notes => null) as id`,
    [s.patient, [site], delegate, course],
  ).then((r) => r.rows[0].id as string);

const updateRestoration = async (c: Client, id: string, delegate: string | null, course: string | null, notes = '') => {
  const at = (await c.query('select updated_at::text as u from public.restorations where id = $1', [id])).rows[0].u;
  await c.query(
    `select public.update_restoration(p_restoration => $1, p_retention => null, p_material => null, p_delegate => $2,
       p_supervisor => null, p_course => $3, p_notes => $4, p_expected_updated_at => $5::timestamptz)`,
    [id, delegate, course, notes, at],
  );
};

const fit = (c: Client, site: string, delegate: string | null, course: string | null) =>
  c.query(
    `select public.fit_component_v2(p_site => $1, p_type => 'healing_abutment', p_fitted_on => public.cairo_today(),
       p_product => null, p_lot => null, p_by_delegate => $2, p_by_organizer => $3, p_notes => '', p_course => $4) as id`,
    [site, delegate, delegate ? null : users.organizer, course],
  ).then((r) => r.rows[0].id as string);

/** A record whose delegate was saved before the rule existed. */
const makeHistoric = async (c: Client, table: string, column: string, id: string, delegate: string) => {
  await asPostgres(c);
  await c.query(`update public.${table} set ${column} = $2 where id = $1`, [id, delegate]);
  await actAs(c, users.organizer);
};

describe('place_implant_v3 enrollment (0081)', () => {
  it('accepts enrolled delegates and refuses others in either role', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await refused(c, () => placeAs(c, s, s.outsider, null), NOT_ENROLLED);
      await refused(c, () => placeAs(c, s, s.member, s.outsider), NOT_ENROLLED);
      expect(await placeAs(c, s, s.member, null)).toBeTruthy();
    });
  });
});

describe('correct_placement_v2 enrollment (0081)', () => {
  it('checks a delegate or course that changes, and leaves an old record editable', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await placeAs(c, s, s.member, null);
      await refused(c, () => correct(c, site, { placing: s.outsider, course: s.course }), NOT_ENROLLED);
      await refused(c, () => correct(c, site, { placing: s.member, assisting: s.outsider, course: s.course }), NOT_ENROLLED);

      const other = await makeCourse(c);
      await refused(c, () => correct(c, site, { placing: s.member, course: other }), /Zz Member is not enrolled in this course/);

      await makeHistoric(c, 'implant_sites', 'placing_delegate_id', site, s.outsider);
      await correct(c, site, { placing: s.outsider, course: s.course, notes: 'Fixed a note' });
      const { rows } = await c.query('select notes from public.implant_sites where id = $1', [site]);
      expect(rows[0].notes).toBe('Fixed a note');
    });
  });
});

describe('restorations enrollment (0081)', () => {
  it('add_restoration refuses a delegate outside its course; no course accepts any delegate', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await placeAs(c, s, s.member, null);
      await refused(c, () => addRestoration(c, s, site, s.outsider, s.course), NOT_ENROLLED);
      expect(await addRestoration(c, s, site, s.outsider, null)).toBeTruthy();
    });
  });

  it('update_restoration checks a change and leaves an old record editable', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await placeAs(c, s, s.member, null);
      const id = await addRestoration(c, s, site, s.member, s.course);
      await refused(c, () => updateRestoration(c, id, s.outsider, s.course), NOT_ENROLLED);

      await makeHistoric(c, 'restorations', 'delegate_id', id, s.outsider);
      await updateRestoration(c, id, s.outsider, s.course, 'Fixed a note');
      const { rows } = await c.query('select notes from public.restorations where id = $1', [id]);
      expect(rows[0].notes).toBe('Fixed a note');
    });
  });
});

describe('fit_component_v2 (0081)', () => {
  it('stores the course and refuses a delegate outside it', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await placeAs(c, s, s.member, null);
      await refused(c, () => fit(c, site, s.outsider, s.course), NOT_ENROLLED);
      const id = await fit(c, site, s.member, s.course);
      const { rows } = await c.query('select course_id from public.site_components where id = $1', [id]);
      expect(rows[0].course_id).toBe(s.course);
    });
  });

  it('accepts any active delegate with no course, and an organizer whatever the course', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await placeAs(c, s, s.member, null);
      expect(await fit(c, site, s.outsider, null)).toBeTruthy();
      expect(await fit(c, site, null, s.course)).toBeTruthy();
    });
  });

  it('refuses an unknown course', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await placeAs(c, s, s.member, null);
      await refused(c, () => fit(c, site, s.member, '00000000-0000-4000-8000-000000000000'), /Choose a course from the list/);
    });
  });
});

describe('enrollments read (0081)', () => {
  it('a Patients-only organizer can read who is enrolled, and nobody without Patients, Courses or Schedule can', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const read = async () =>
        (await c.query('select delegate_id from public.enrollments where course_id = $1', [s.course])).rows.map((r) => r.delegate_id);

      await asPostgres(c);
      await setPerms(c, users.target, { patients: 'view' });
      await actAs(c, users.target);
      expect(await read()).toEqual([s.member]);

      await asPostgres(c);
      await setPerms(c, users.target, {});
      await actAs(c, users.target);
      expect(await read()).toEqual([]);
    });
  });
});

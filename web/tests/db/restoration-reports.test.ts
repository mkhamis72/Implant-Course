import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { enroll, makeCourse, makeDelegate, makePatient, makeProduct, place, receive, setPerms } from './fixtures';

const users = inject('testUsers');

const daysAgo = async (c: Client, n: number) =>
  (await c.query('select (public.cairo_today() - $1::int)::text as d', [n])).rows[0].d as string;

async function setup(c: Client, name = 'Zz Resto Report Patient') {
  await actAs(c, users.organizer);
  const implant = await makeProduct(c);
  const lot = await receive(c, implant, 10, 'RRP');
  const delegate = await makeDelegate(c, 'Zz Resto Report Delegate');
  const patient = await makePatient(c, name);
  const placedOn = await daysAgo(c, 60);
  const placeAt = (tooth: number) =>
    place(c, { patient, tooth, product: implant, lot, delegate, supervisor: users.organizer, placedOn });
  return { patient, delegate, placedOn, placeAt };
}

const add = async (c: Client, patient: string, sites: string[], o: {
  type?: string; teeth?: number[] | null; fittedOn?: string; delegate?: string | null; course?: string | null;
} = {}) =>
  (await c.query(
    `select public.add_restoration(p_patient => $1, p_stage => 'final', p_type => $2, p_sites => $3::uuid[],
       p_teeth => $4::smallint[], p_fitted_on => coalesce($5::date, public.cairo_today()), p_retention => null,
       p_material => null, p_delegate => $6, p_supervisor => null, p_course => $7, p_remake_reason => null,
       p_notes => '') as id`,
    [patient, o.type ?? 'single_crown', sites, o.teeth ?? null, o.fittedOn ?? null, o.delegate ?? null, o.course ?? null],
  )).rows[0].id as string;

const stateOf = async (c: Client, site: string) =>
  (await c.query('select state from public.implant_sites where id = $1', [site])).rows[0].state as string;
const toothOf = async (c: Client, patient: string, tooth: number) =>
  (await c.query('select status from public.tooth_status where patient_id = $1 and tooth = $2', [patient, tooth])).rows[0]
    ?.status as string | undefined;
const ids = (rows: { restoration_id: string }[]) => rows.map((r) => r.restoration_id);

describe('restorations in course reports', () => {
  it('counts a restoration in its own course, or in the course its delegate was enrolled in on the date fitted', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const current = await makeCourse(c, await daysAgo(c, 10), await daysAgo(c, -10));
      const notEnrolled = await makeCourse(c, await daysAgo(c, 10), await daysAgo(c, -10));
      const later = await makeCourse(c, '2030-03-01', '2030-03-05');
      await enroll(c, current, s.delegate);
      await enroll(c, later, s.delegate);

      const derived = await add(c, s.patient, [await s.placeAt(36)], { delegate: s.delegate });
      const explicit = await add(c, s.patient, [await s.placeAt(46)], { delegate: s.delegate, course: later });

      const inCurrent = (await c.query('select * from public.course_restorations($1)', [current])).rows;
      expect(ids(inCurrent)).toEqual([derived]);
      expect(inCurrent[0]).toMatchObject({
        patient_name: 'Zz Resto Report Patient', teeth: [36], stage: 'final', type: 'single_crown',
        delegate_id: s.delegate, delegate: 'Zz Resto Report Delegate', ended_on: null, end_kind: null,
      });
      expect(ids((await c.query('select * from public.course_restorations($1)', [later])).rows)).toEqual([explicit]);
      expect((await c.query('select * from public.course_restorations($1)', [notEnrolled])).rows).toEqual([]);

      // Voided restorations drop out.
      await c.query('select public.void_restoration($1, $2)', [explicit, 'Wrong course']);
      expect((await c.query('select * from public.course_restorations($1)', [later])).rows).toEqual([]);
    });
  });

  it('course_restorations obeys View on Patients', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const course = await makeCourse(c);
      await add(c, s.patient, [await s.placeAt(36)], { course });
      await actAs(c, users.viewer);
      expect((await c.query('select * from public.course_restorations($1)', [course])).rows).toHaveLength(1);
      await setPerms(c, users.target, { courses: 'view' });
      await actAs(c, users.target);
      expect((await c.query('select * from public.course_restorations($1)', [course])).rows).toEqual([]);
    });
  });

  it('delegate_restorations lists a delegate’s restorations with their course', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const course = await makeCourse(c, await daysAgo(c, 10), await daysAgo(c, -10));
      await enroll(c, course, s.delegate);
      const mine = await add(c, s.patient, [await s.placeAt(36)], { delegate: s.delegate });
      const other = await makeDelegate(c, 'Zz Resto Other Delegate');
      await add(c, s.patient, [await s.placeAt(46)], { delegate: other });
      const rows = (await c.query('select * from public.delegate_restorations($1)', [s.delegate])).rows;
      expect(ids(rows)).toEqual([mine]);
      expect(rows[0]).toMatchObject({ course_id: course, course_name: 'Test Course', patient_id: s.patient, teeth: [36], stage: 'final' });
    });
  });

  it('my_restorations shows a delegate login only their own', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await asPostgres(c);
      const me = (await c.query('select delegate_id from public.profiles where user_id = $1', [users.delegate])).rows[0]
        .delegate_id as string;
      await actAs(c, users.organizer);
      const mine = await add(c, s.patient, [await s.placeAt(36)], { delegate: me });
      await add(c, s.patient, [await s.placeAt(46)], { delegate: s.delegate });
      // Staff can't call it.
      await c.query('savepoint s');
      await expect(c.query('select * from public.my_restorations()')).rejects.toThrow(/delegate logins/);
      await c.query('rollback to savepoint s');
      await actAs(c, users.delegate);
      const rows = (await c.query('select * from public.my_restorations()')).rows;
      expect(ids(rows)).toEqual([mine]);
      expect(rows[0]).toMatchObject({ patient_name: 'Zz Resto Report Patient', teeth: [36], stage: 'final', type: 'single_crown' });
    });
  });
});

describe('restored state belongs to restorations', () => {
  it('a bridge stays on its other implant when one fails, and voiding the failure restores it', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const a = await s.placeAt(34);
      const b = await s.placeAt(36);
      await add(c, s.patient, [a, b], { type: 'bridge', teeth: [34, 35, 36], fittedOn: await daysAgo(c, 20) });
      const visit = (await c.query(
        `select public.record_visit($1, public.cairo_today(), null, 'Review', 'attended', 'failed', $2::jsonb, '') as id`,
        [b, JSON.stringify({ failure_type: 'lost', failure_reason: 'fracture' })])).rows[0].id as string;
      expect(await stateOf(c, b)).toBe('failed');
      expect(await stateOf(c, a)).toBe('restored');
      await c.query(`select public.void_followup($1, 'Wrong tooth')`, [visit]);
      expect(await stateOf(c, b)).toBe('restored');
      expect(await toothOf(c, s.patient, 36)).toBe('restored');
    });
  });

  it('voiding a failure on an implant with only a temporary leaves it placed', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await s.placeAt(36);
      await c.query(
        `select public.add_restoration(p_patient => $1, p_stage => 'temporary', p_type => 'single_crown', p_sites => array[$2::uuid],
           p_teeth => null, p_fitted_on => public.cairo_today(), p_retention => null, p_material => null, p_delegate => null,
           p_supervisor => null, p_course => null, p_remake_reason => null, p_notes => '')`, [s.patient, site]);
      const visit = (await c.query(
        `select public.record_visit($1, public.cairo_today(), null, 'Review', 'attended', 'failed', $2::jsonb, '') as id`,
        [site, JSON.stringify({ failure_type: 'lost', failure_reason: 'fracture' })])).rows[0].id as string;
      await c.query(`select public.void_followup($1, 'Wrong tooth')`, [visit]);
      expect(await stateOf(c, site)).toBe('placed');
      expect(await toothOf(c, s.patient, 36)).toBe('implant_placed');
    });
  });

  it('voiding a fitted final_restoration component leaves the state to restorations', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const fit = async (site: string) => (await c.query(
        `select public.fit_component_v2(p_site => $1, p_type => 'final_restoration', p_fitted_on => public.cairo_today(),
           p_product => null, p_lot => null, p_by_delegate => $2, p_by_organizer => null, p_notes => '', p_course => null) as id`, [site, s.delegate])).rows[0].id as string;

      // With a current final restoration the implant stays restored.
      const kept = await s.placeAt(36);
      await add(c, s.patient, [kept]);
      const c1 = await fit(kept);
      await c.query(`select public.void_component($1, 'Recorded twice')`, [c1]);
      expect(await stateOf(c, kept)).toBe('restored');
      expect(await toothOf(c, s.patient, 36)).toBe('restored');

      // Without one it goes back to placed.
      const bare = await s.placeAt(46);
      const c2 = await fit(bare);
      expect(await stateOf(c, bare)).toBe('restored');
      await c.query(`select public.void_component($1, 'Wrong tooth')`, [c2]);
      expect(await stateOf(c, bare)).toBe('placed');
      expect(await toothOf(c, s.patient, 46)).toBe('implant_placed');
    });
  });
});

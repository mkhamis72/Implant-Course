import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs } from './helpers';
import { book, enroll, makeChair, makeCourse, makeDelegate, makePatient, makeProduct, makeSession, receive, setPerms } from './fixtures';

const users = inject('testUsers');

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

async function setup(c: Client) {
  await actAs(c, users.organizer);
  const patient = await makePatient(c, 'Zz Placement Course Patient');
  const product = await makeProduct(c);
  const lot = await receive(c, product, 5, 'PC-1', '2031-01-01');
  const delegate = await makeDelegate(c, 'Zz Placement Course Delegate');
  const course = await makeCourse(c, '2026-03-01', '2026-03-05');
  await enroll(c, course, delegate);
  return { patient, product, lot, delegate, course };
}

const placeV3 = (c: Client, s: Awaited<ReturnType<typeof setup>>, f: { tooth: number; course: string | null; slot?: string }) =>
  c.query(
    `select public.place_implant_v3(p_patient => $1, p_tooth => $2::smallint, p_product => $3, p_lot => $4,
       p_placed_on => '2026-03-02'::date, p_placing_delegate => $5, p_supervisor => $6, p_assisting_delegate => null,
       p_graft => '', p_notes => '', p_slot => $7, p_technique => 'guided', p_course => $8) as id`,
    [s.patient, f.tooth, s.product, s.lot, s.delegate, users.organizer, f.slot ?? null, f.course],
  ).then((r) => r.rows[0].id as string);

const courseOf = async (c: Client, site: string) =>
  (await c.query('select course_id from public.implant_sites where id = $1', [site])).rows[0].course_id;

describe('placement records its course', () => {
  it('v3 stores the course', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await placeV3(c, s, { tooth: 36, course: s.course });
      expect(await courseOf(c, site)).toBe(s.course);
    });
  });

  it('v3 refuses no course and an unknown course', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await refused(c, () => placeV3(c, s, { tooth: 36, course: null }), /Choose the course\./);
      await refused(c, () => placeV3(c, s, { tooth: 36, course: '00000000-0000-0000-0000-000000000000' }), /Choose the course\./);
    });
  });

  it('v3 with a slot keeps the chosen course', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await actAs(c, users.admin);
      const chair = await makeChair(c);
      await actAs(c, users.organizer);
      const sessionCourse = await makeCourse(c);
      await enroll(c, sessionCourse, s.delegate);
      const session = await makeSession(c, sessionCourse);
      const slot = await book(c, {
        session, chair, patient: s.patient, supervisor: users.organizer, placing: [s.delegate],
        implants: [{ tooth: 36, product_id: s.product }],
      });
      const site = await placeV3(c, s, { tooth: 36, course: s.course, slot });
      expect(await courseOf(c, site)).toBe(s.course);
      const row = (await c.query('select slot_id, session_id from public.implant_sites where id = $1', [site])).rows[0];
      expect(row).toEqual({ slot_id: slot, session_id: session });
    });
  });

  it('correct_placement_v2 changes the course and requires one', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await placeV3(c, s, { tooth: 36, course: s.course });
      const other = await makeCourse(c, '2026-04-01', '2026-04-05');
      await enroll(c, other, s.delegate);
      const correct = (course: string | null) =>
        c.query(
          `select public.correct_placement_v2(p_site => $1, p_placed_on => '2026-03-02'::date, p_placing_delegate => $2,
             p_assisting_delegate => null, p_supervisor => $3, p_course => $4, p_graft => '', p_notes => '')`,
          [site, s.delegate, users.organizer, course],
        );
      await correct(other);
      expect(await courseOf(c, site)).toBe(other);
      await refused(c, () => correct(null), /Choose the course\./);
      expect(await courseOf(c, site)).toBe(other);
    });
  });

  it('correct_placement_v2 refuses a placement date after a fitted restoration', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await placeV3(c, s, { tooth: 36, course: s.course });
      await c.query(
        `select public.add_restoration(p_patient => $1, p_stage => 'temporary', p_type => 'single_crown',
           p_sites => array[$2::uuid], p_teeth => array[36]::smallint[], p_fitted_on => '2026-03-03'::date,
           p_retention => null, p_material => null, p_delegate => $3, p_supervisor => null, p_course => null,
           p_remake_reason => null, p_notes => '')`,
        [s.patient, site, s.delegate],
      );
      const correct = (placedOn: string) =>
        c.query(
          `select public.correct_placement_v2(p_site => $1, p_placed_on => $2::date, p_placing_delegate => $3,
             p_assisting_delegate => null, p_supervisor => $4, p_course => $5, p_graft => '', p_notes => '')`,
          [site, placedOn, s.delegate, users.organizer, s.course],
        );
      await refused(c, () => correct('2026-03-04'), /can't be placed after its first .*restoration.*\(2026-03-03\)/);
      await correct('2026-03-03');
    });
  });

  it('correct_placement_v2 refuses a placement date after a non-planning X-ray or the scan (0075)', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const xraySite = await placeV3(c, s, { tooth: 36, course: s.course });
      const scanSite = await placeV3(c, s, { tooth: 46, course: s.course });
      const correct = (site: string, placedOn: string) =>
        c.query(
          `select public.correct_placement_v2(p_site => $1, p_placed_on => $2::date, p_placing_delegate => $3,
             p_assisting_delegate => null, p_supervisor => $4, p_course => $5, p_graft => '', p_notes => '')`,
          [site, placedOn, s.delegate, users.organizer, s.course],
        );
      const xray = (purpose: string, on: string) =>
        c.query(
          `select public.save_radiograph(p_id => null, p_patient => $1, p_taken_on => $2::date, p_type => 'periapical',
             p_purpose => $3, p_teeth => array[36]::smallint[], p_link => null, p_notes => null, p_levels => '[]'::jsonb,
             p_expected_updated_at => null)`,
          [s.patient, on, purpose],
        );
      // A planning X-ray never limits the placement date; a baseline one does.
      await xray('planning', '2026-03-01');
      await xray('baseline', '2026-03-05');
      await correct(xraySite, '2026-03-05');
      await refused(c, () => correct(xraySite, '2026-03-06'), /can't be placed after its first .*X-ray.*\(2026-03-05\)/);

      const v = (await c.query('select updated_at::text as v from public.implant_sites where id = $1', [scanSite])).rows[0].v;
      await c.query(`select public.record_impression($1, 'digital_scan', $2::date, $3::timestamptz)`, [scanSite, '2026-03-04', v]);
      await refused(c, () => correct(scanSite, '2026-03-05'), /can't be placed after its first .*scan.*\(2026-03-04\)/);
      await correct(scanSite, '2026-03-04');
    });
  });

  it('needs Edit on Patients', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await placeV3(c, s, { tooth: 36, course: s.course });
      await setPerms(c, users.organizer, { patients: 'view' });
      await refused(c, () => placeV3(c, s, { tooth: 46, course: s.course }), /permission/i);
      await refused(
        c,
        () => c.query(
          `select public.correct_placement_v2(p_site => $1, p_placed_on => '2026-03-02'::date, p_placing_delegate => $2,
             p_assisting_delegate => null, p_supervisor => $3, p_course => $4, p_graft => '', p_notes => '')`,
          [site, s.delegate, users.organizer, s.course],
        ),
        /permission/i,
      );
    });
  });
});

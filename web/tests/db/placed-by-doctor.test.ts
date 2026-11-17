import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asCompany, asPostgres } from './helpers';
import { enroll, makeChair, makeCourse, makeDelegate, makePatient, makeProduct, makeSession, place, receive } from './fixtures';

// Modules release 3 (0115): implants placed and surgeries booked by a doctor; the clinic rules.

const users = inject('testUsers');
const ACADEMY = 'a7c0de00-0000-4000-8000-000000000001';
const NOT_USED = 'Courses, delegates and supervisors are not used in your plan.';
const CHOOSE_DOCTOR = 'Choose the doctor who placed the implant.';

const one = async (c: Client, sql: string, params: unknown[] = []) => Object.values((await c.query(sql, params)).rows[0])[0];

/** The error a statement raises (inside a savepoint, so the test's transaction goes on), or null. */
async function raised(c: Client, sql: string, params: unknown[] = []): Promise<string | null> {
  await c.query('savepoint s');
  try {
    await c.query(sql, params);
    await c.query('release savepoint s');
    return null;
  } catch (e) {
    await c.query('rollback to savepoint s');
    return (e as Error).message;
  }
}

type Seed = { product: string; lot: string; patient: string; doctor: string; supervisor: string; course: string; delegate: string };

/** A received lot (as the admin, Inventory on), a patient, a doctor, a supervisor and a course with an enrolled delegate. */
async function seed(c: Client, name: string): Promise<Seed> {
  await actAs(c, users.admin, { aal: 'aal2' });
  const product = await makeProduct(c, 'implant', `Zz Doc ${name}`);
  const lot = await receive(c, product, 5, `ZZDOC${name}`);
  await asCompany(c);
  const patient = await makePatient(c, `Zz Doc ${name} Patient`);
  const doctor = (await one(c, `insert into public.doctors (name) values ($1) returning id`, [`Zz Dr ${name}`])) as string;
  const supervisor = (await one(c, `insert into public.supervisors (full_name) values ($1) returning id`, [`Zz Sup ${name}`])) as string;
  const course = await makeCourse(c);
  const delegate = await makeDelegate(c, `Zz Doc ${name} Delegate`);
  await enroll(c, course, delegate);
  return { product, lot, patient, doctor, supervisor, course, delegate };
}

async function clinic(c: Client) {
  await asPostgres(c);
  await c.query(`update public.companies set kind = 'clinic' where id = $1`, [ACADEMY]);
}

type V4 = {
  patient: string; tooth: number; product: string; lot: string | null; delegate?: string | null; supervisor?: string | null;
  assistant?: string | null; slot?: string | null; course?: string | null; doctor?: string | null;
};
const V4_SQL = `select public.place_implant_v4(
  p_patient => $1, p_tooth => $2::smallint, p_product => $3, p_lot => $4, p_placed_on => public.cairo_today(),
  p_placing_delegate => $5, p_supervisor => $6, p_assisting_delegate => $7, p_graft => '', p_notes => '',
  p_slot => $8, p_technique => null, p_course => $9, p_placing_doctor => $10) as id`;
const v4Params = (a: V4) => [a.patient, a.tooth, a.product, a.lot, a.delegate ?? null, a.supervisor ?? null,
  a.assistant ?? null, a.slot ?? null, a.course ?? null, a.doctor ?? null];
const v4 = async (c: Client, a: V4) => (await one(c, V4_SQL, v4Params(a))) as string;
const v4Error = (c: Client, a: V4) => raised(c, V4_SQL, v4Params(a));

describe('placed by a doctor; clinic rules (0115)', () => {
  it('organizer places by doctor', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'OrgDoc');
      await actAs(c, users.organizer);
      const base = { patient: s.patient, product: s.product, lot: s.lot, course: s.course };

      const site = await v4(c, { ...base, tooth: 36, doctor: s.doctor });
      expect((await c.query('select state, placing_doctor_id, placing_delegate_id, supervisor_id, course_id from public.implant_sites where id = $1', [site])).rows[0])
        .toEqual({ state: 'placed', placing_doctor_id: s.doctor, placing_delegate_id: null, supervisor_id: null, course_id: s.course });

      expect(await v4Error(c, { ...base, tooth: 46, doctor: s.doctor, delegate: s.delegate, supervisor: s.supervisor }))
        .toBe('Choose a delegate or a doctor, not both.');
      expect(await v4Error(c, { ...base, tooth: 46 })).toBe('Choose the delegate who placed the implant.');
      expect(await v4Error(c, { ...base, tooth: 46, doctor: s.doctor, course: null })).toBe('Choose the course.');
      // An assisting delegate is allowed with a doctor, and must be enrolled.
      const stranger = await (async () => { await asCompany(c); const d = await makeDelegate(c, 'Zz Doc Stranger'); await actAs(c, users.organizer); return d; })();
      expect(await v4Error(c, { ...base, tooth: 46, doctor: s.doctor, assistant: stranger })).toBe('Zz Doc Stranger is not enrolled in this course.');
      const assisted = await v4(c, { ...base, tooth: 46, doctor: s.doctor, assistant: s.delegate, supervisor: s.supervisor });
      expect(await one(c, 'select assisting_delegate_id from public.implant_sites where id = $1', [assisted])).toBe(s.delegate);

      // An inactive doctor is refused.
      await asPostgres(c);
      await c.query('update public.doctors set active = false where id = $1', [s.doctor]);
      await actAs(c, users.organizer);
      expect(await v4Error(c, { ...base, tooth: 47, doctor: s.doctor })).toBe(CHOOSE_DOCTOR);
    });
  });

  it("another company's doctor is refused", async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'OtherCo');
      await asPostgres(c);
      const other = await one(c, 'select id from public.companies where id <> $1 order by created_at limit 1', [ACADEMY]);
      const foreign = await one(c, `insert into public.doctors (company_id, name) values ($1, 'Zz Dr Foreign') returning id`, [other]);
      await actAs(c, users.organizer);
      // The function's active-doctor check can't see it (company policies apply to tenant_definer).
      expect(await v4Error(c, { patient: s.patient, tooth: 36, product: s.product, lot: s.lot, course: s.course, doctor: foreign as string }))
        .toBe(CHOOSE_DOCTOR);
    });
  });

  it('organizer places by delegate through v4 as through v3', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'OrgDel');
      await actAs(c, users.organizer);
      const base = { patient: s.patient, product: s.product, lot: s.lot, course: s.course, delegate: s.delegate };
      expect(await v4Error(c, { ...base, tooth: 36 })).toBe('Choose an active supervisor.');
      const site = await v4(c, { ...base, tooth: 36, supervisor: s.supervisor });
      expect((await c.query('select placing_delegate_id, placing_doctor_id, supervisor_id from public.implant_sites where id = $1', [site])).rows[0])
        .toEqual({ placing_delegate_id: s.delegate, placing_doctor_id: null, supervisor_id: s.supervisor });

      // v3 still requires the supervisor.
      expect(await raised(c, `select public.place_implant_v3(
          p_patient => $1, p_tooth => 46::smallint, p_product => $2, p_lot => $3, p_placed_on => public.cairo_today(),
          p_placing_delegate => $4, p_supervisor => null, p_assisting_delegate => null, p_graft => '', p_notes => '',
          p_slot => null, p_technique => null, p_course => $5)`, [s.patient, s.product, s.lot, s.delegate, s.course]))
        .toBe('Choose an active supervisor.');
    });
  });

  it('old v3 still works for an organizer', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'V3');
      await actAs(c, users.organizer);
      const site = await place(c, { patient: s.patient, tooth: 36, product: s.product, lot: s.lot, delegate: s.delegate, supervisor: s.supervisor, course: s.course });
      expect((await c.query('select state, placing_delegate_id, placing_doctor_id from public.implant_sites where id = $1', [site])).rows[0])
        .toEqual({ state: 'placed', placing_delegate_id: s.delegate, placing_doctor_id: null });
    });
  });

  it('course_report lists a doctor placement', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'Report');
      await actAs(c, users.organizer);
      const site = await v4(c, { patient: s.patient, tooth: 36, product: s.product, lot: s.lot, course: s.course, doctor: s.doctor });
      const { rows } = await c.query('select site_id, placing_delegate, supervisor from public.course_report($1)', [s.course]);
      expect(rows).toEqual([{ site_id: site, placing_delegate: null, supervisor: null }]);
    });
  });

  it('correct_placement_v3 moves between delegate and doctor', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'Correct');
      await actAs(c, users.organizer);
      const site = await v4(c, { patient: s.patient, tooth: 36, product: s.product, lot: s.lot, course: s.course, delegate: s.delegate, supervisor: s.supervisor });
      const correct = (a: { delegate?: string | null; doctor?: string | null; supervisor?: string | null; course?: string | null }) => raised(c,
        `select public.correct_placement_v3(p_site => $1, p_placed_on => public.cairo_today(), p_placing_delegate => $2,
           p_assisting_delegate => null, p_supervisor => $3, p_course => $4, p_graft => '', p_notes => '', p_placing_doctor => $5)`,
        [site, a.delegate ?? null, a.supervisor ?? null, a.course === undefined ? s.course : a.course, a.doctor ?? null]);

      expect(await correct({ delegate: s.delegate, doctor: s.doctor, supervisor: s.supervisor })).toBe('Choose a delegate or a doctor, not both.');
      expect(await correct({ delegate: s.delegate })).toBe('Choose an active supervisor.');
      expect(await correct({ doctor: s.doctor })).toBeNull();
      expect((await c.query('select placing_delegate_id, placing_doctor_id, supervisor_id from public.implant_sites where id = $1', [site])).rows[0])
        .toEqual({ placing_delegate_id: null, placing_doctor_id: s.doctor, supervisor_id: null });
      // The recorded doctor may have become inactive since.
      await asPostgres(c);
      await c.query('update public.doctors set active = false where id = $1', [s.doctor]);
      await actAs(c, users.organizer);
      expect(await correct({ doctor: s.doctor, supervisor: s.supervisor })).toBeNull();

      await clinic(c);
      await actAs(c, users.organizer);
      expect(await correct({ doctor: s.doctor, supervisor: s.supervisor, course: null })).toBe(NOT_USED);
      expect(await correct({ doctor: s.doctor })).toBe(NOT_USED);
      expect(await correct({ course: null })).toBe(CHOOSE_DOCTOR);
      expect(await correct({ doctor: s.doctor, course: null })).toBeNull();
      expect(await one(c, 'select course_id from public.implant_sites where id = $1', [site])).toBeNull();
    });
  });

  it('clinic places by doctor only', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'Clinic');
      await clinic(c);
      await actAs(c, users.organizer);
      const base = { patient: s.patient, product: s.product, lot: s.lot };

      expect(await v4Error(c, { ...base, tooth: 36, doctor: s.doctor, course: s.course })).toBe(NOT_USED);
      expect(await v4Error(c, { ...base, tooth: 36, doctor: s.doctor, supervisor: s.supervisor })).toBe(NOT_USED);
      expect(await v4Error(c, { ...base, tooth: 36, doctor: s.doctor, delegate: s.delegate })).toBe(NOT_USED);
      expect(await v4Error(c, { ...base, tooth: 36, doctor: s.doctor, assistant: s.delegate })).toBe(NOT_USED);
      expect(await v4Error(c, { ...base, tooth: 36 })).toBe(CHOOSE_DOCTOR);

      const site = await v4(c, { ...base, tooth: 36, doctor: s.doctor });
      expect((await c.query('select state, placing_doctor_id, placing_delegate_id, supervisor_id, course_id from public.implant_sites where id = $1', [site])).rows[0])
        .toEqual({ state: 'placed', placing_doctor_id: s.doctor, placing_delegate_id: null, supervisor_id: null, course_id: null });
    });
  });

  it('clinic slot to placement', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'Slot');
      const chair = await makeChair(c);
      await clinic(c);
      await actAs(c, users.organizer);

      expect(await raised(c, `select public.add_surgery_session($1, '2030-03-02', 'Zz Clinic day', '08:00', '17:00', null)`, [s.course]))
        .toBe(NOT_USED);
      const day = await one(c, `select public.add_surgery_session(null, '2030-03-02', 'Zz Clinic day', '08:00', '17:00', null)`);
      expect(await one(c, 'select course_id from public.sessions where id = $1', [day])).toBeNull();

      const slotSql = `select public.create_surgery_slot_v2(
        p_session => $1, p_chair => $2, p_start => '09:00', p_end => '10:00', p_patient => $3, p_supervisor => $4,
        p_placing => $5::uuid[], p_assisting => $6::uuid[], p_implants => $7::jsonb, p_override_reason => '', p_notes => '',
        p_placing_doctor => $8) as id`;
      const implants = JSON.stringify([{ tooth: 36, product_id: s.product }]);
      expect(await raised(c, slotSql, [day, chair, s.patient, null, [], [], implants, null])).toBe(CHOOSE_DOCTOR);
      expect(await raised(c, slotSql, [day, chair, s.patient, s.supervisor, [], [], implants, s.doctor])).toBe(NOT_USED);
      expect(await raised(c, slotSql, [day, chair, s.patient, null, [s.delegate], [], implants, s.doctor])).toBe(NOT_USED);
      expect(await raised(c, slotSql, [day, chair, s.patient, null, [], [s.delegate], implants, s.doctor])).toBe(NOT_USED);
      const slot = await one(c, slotSql, [day, chair, s.patient, null, [], [], implants, s.doctor]);
      expect((await c.query('select placing_doctor_id, supervisor_id from public.surgery_slots where id = $1', [slot])).rows[0])
        .toEqual({ placing_doctor_id: s.doctor, supervisor_id: null });

      // Editing the booking follows the same rules.
      const updSql = `select public.update_surgery_slot_v2(
        p_slot => $1, p_chair => $2, p_start => '09:00', p_end => '11:00', p_supervisor => $3, p_placing => $4::uuid[],
        p_assisting => '{}'::uuid[], p_override_reason => '', p_notes => 'Zz edited', p_placing_doctor => $5)`;
      expect(await raised(c, updSql, [slot, chair, null, [], null])).toBe(CHOOSE_DOCTOR);
      expect(await raised(c, updSql, [slot, chair, s.supervisor, [], s.doctor])).toBe(NOT_USED);
      expect(await raised(c, updSql, [slot, chair, null, [], s.doctor])).toBeNull();

      const site = await v4(c, { patient: s.patient, tooth: 36, product: s.product, lot: s.lot, slot: slot as string });
      expect((await c.query('select placing_doctor_id, slot_id, session_id, course_id from public.implant_sites where id = $1', [site])).rows[0])
        .toEqual({ placing_doctor_id: s.doctor, slot_id: slot, session_id: day, course_id: null });
      expect(await one(c, 'select status from public.surgery_slots where id = $1', [slot])).toBe('done');
    });
  });

  it('a clinic may book any session of the company', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'AnySession');
      const chair = await makeChair(c);
      const courseSession = await makeSession(c, s.course);
      await clinic(c);
      await actAs(c, users.organizer);
      const slot = await one(c, `select public.create_surgery_slot_v2(
        p_session => $1, p_chair => $2, p_start => '09:00', p_end => '10:00', p_patient => $3, p_supervisor => null,
        p_placing => '{}'::uuid[], p_assisting => '{}'::uuid[], p_implants => '[]'::jsonb, p_override_reason => '', p_notes => '',
        p_placing_doctor => $4) as id`, [courseSession, chair, s.patient, s.doctor]);
      expect(await one(c, 'select placing_doctor_id from public.surgery_slots where id = $1', [slot])).toBe(s.doctor);
    });
  });

  it('organizer books with a doctor or with delegates', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'OrgSlot');
      const chair = await makeChair(c);
      const session = await makeSession(c, s.course);
      await actAs(c, users.organizer);
      const slotSql = `select public.create_surgery_slot_v2(
        p_session => $1, p_chair => $2, p_start => $3::time, p_end => $4::time, p_patient => $5, p_supervisor => $6,
        p_placing => $7::uuid[], p_assisting => $8::uuid[], p_implants => '[]'::jsonb, p_override_reason => '', p_notes => '',
        p_placing_doctor => $9) as id`;
      expect(await raised(c, slotSql, [session, chair, '09:00', '10:00', s.patient, s.supervisor, [s.delegate], [], s.doctor]))
        .toBe('Choose a delegate or a doctor, not both.');
      expect(await raised(c, slotSql, [session, chair, '09:00', '10:00', s.patient, null, [s.delegate], [], null]))
        .toBe('Choose an active supervisor.');
      expect(await raised(c, slotSql, [session, chair, '09:00', '10:00', s.patient, s.supervisor, [], [], null]))
        .toBe('Choose at least one placing delegate.');
      // A doctor: no supervisor needed; an assisting delegate is enrolment-checked.
      const stranger = await (async () => { await asCompany(c); const d = await makeDelegate(c, 'Zz Doc Slot Stranger'); await actAs(c, users.organizer); return d; })();
      expect(await raised(c, slotSql, [session, chair, '09:00', '10:00', s.patient, null, [], [stranger], s.doctor]))
        .toBe('Zz Doc Slot Stranger is not enrolled in this course.');
      const bySlotDoctor = await one(c, slotSql, [session, chair, '09:00', '10:00', s.patient, null, [], [s.delegate], s.doctor]);
      expect(await one(c, 'select placing_doctor_id from public.surgery_slots where id = $1', [bySlotDoctor])).toBe(s.doctor);
      const byDelegate = await one(c, slotSql, [session, chair, '11:00', '12:00', s.patient, s.supervisor, [s.delegate], [], null]);
      expect(await one(c, 'select placing_doctor_id from public.surgery_slots where id = $1', [byDelegate])).toBeNull();

      // Switching a booking from the doctor to delegates clears the doctor.
      await c.query(`select public.update_surgery_slot_v2(
        p_slot => $1, p_chair => $2, p_start => '09:00', p_end => '10:00', p_supervisor => $3, p_placing => $4::uuid[],
        p_assisting => '{}'::uuid[], p_override_reason => 'Zz same patient', p_notes => '', p_placing_doctor => null)`,
        [bySlotDoctor, chair, s.supervisor, [s.delegate]]);
      expect((await c.query('select placing_doctor_id, supervisor_id from public.surgery_slots where id = $1', [bySlotDoctor])).rows[0])
        .toEqual({ placing_doctor_id: null, supervisor_id: s.supervisor });

      // A course organizer's session still needs its course.
      expect(await raised(c, `select public.add_surgery_session(null, '2030-03-02', 'Zz No course', '08:00', '17:00', null)`))
        .toBe('Course not found.');
    });
  });

  it('clinic restorations name no delegate, supervisor or course', async () => {
    await withTx(async (c) => {
      const s = await seed(c, 'Resto');
      await clinic(c);
      await actAs(c, users.organizer);
      const site = await v4(c, { patient: s.patient, tooth: 36, product: s.product, lot: s.lot, doctor: s.doctor });
      const addSql = `select public.add_restoration(
        p_patient => $1, p_stage => 'temporary', p_type => 'single_crown', p_sites => array[$2]::uuid[], p_teeth => null,
        p_fitted_on => public.cairo_today(), p_retention => null, p_material => null, p_delegate => $3, p_supervisor => $4,
        p_course => $5, p_remake_reason => null, p_notes => '') as id`;
      expect(await raised(c, addSql, [s.patient, site, s.delegate, null, null])).toBe(NOT_USED);
      expect(await raised(c, addSql, [s.patient, site, null, s.supervisor, null])).toBe(NOT_USED);
      expect(await raised(c, addSql, [s.patient, site, null, null, s.course])).toBe(NOT_USED);
      const r = await one(c, addSql, [s.patient, site, null, null, null]);

      const at = await one(c, 'select updated_at::text from public.restorations where id = $1', [r]);
      const updSql = `select public.update_restoration(p_restoration => $1, p_retention => null, p_material => null,
        p_delegate => $2, p_supervisor => null, p_course => null, p_notes => 'Zz', p_expected_updated_at => $3::timestamptz)`;
      expect(await raised(c, updSql, [r, s.delegate, at])).toBe(NOT_USED);
      expect(await raised(c, updSql, [r, null, at])).toBeNull();
    });
  });
});

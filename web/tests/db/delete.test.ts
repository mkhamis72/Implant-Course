import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs } from './helpers';
import { book, enroll, makeChair, makeCourse, makeDelegate, makePatient, makeProduct, makeSession, place, receive } from './fixtures';

const users = inject('testUsers');

async function world(c: Client) {
  await actAs(c, users.admin);
  const chair = await makeChair(c);
  await actAs(c, users.organizer);
  const course = await makeCourse(c);
  const session = await makeSession(c, course);
  const delegate = await makeDelegate(c, 'Dr Delete');
  await enroll(c, course, delegate);
  const patient = await makePatient(c, 'Zz Delete Patient');
  const product = await makeProduct(c);
  const lot = await receive(c, product, 5, 'DEL-1', '2031-01-01');
  return { chair, course, session, delegate, patient, product, lot, supervisor: users.organizer };
}

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

async function count(c: Client, sql: string, id: string) {
  return Number((await c.query(sql, [id])).rows[0].n);
}

describe('deleting a patient', () => {
  it('removes a patient with only plans, bookings and notes, and everything of theirs', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.query("select public.plan_implant(p_patient => $1, p_tooth => 11::smallint)", [w.patient]);
      const slot = await book(c, { ...w, placing: [w.delegate], implants: [{ tooth: 36 }] });
      await c.query("insert into public.visit_notes (patient_id, text) values ($1, 'Consult')", [w.patient]);
      await c.query("insert into public.tooth_status (patient_id, tooth, status) values ($1, 18, 'missing')", [w.patient]);

      await c.query('select public.delete_patient($1)', [w.patient]);

      expect(await count(c, 'select count(*) as n from public.patients where id = $1', w.patient)).toBe(0);
      expect(await count(c, 'select count(*) as n from public.implant_sites where patient_id = $1', w.patient)).toBe(0);
      expect(await count(c, 'select count(*) as n from public.surgery_slots where id = $1', slot)).toBe(0);
      expect(await count(c, 'select count(*) as n from public.checklists where slot_id = $1', slot)).toBe(0);
      expect(await count(c, 'select count(*) as n from public.visit_notes where patient_id = $1', w.patient)).toBe(0);
    });
  });

  it('refuses a patient with a placed implant', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await place(c, { patient: w.patient, tooth: 36, product: w.product, lot: w.lot, delegate: w.delegate, supervisor: w.supervisor });
      await refused(c, () => c.query('select public.delete_patient($1)', [w.patient]), /stock movements .* Archive them instead/);
    });
  });

  it('cannot be done with a direct delete', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await refused(c, () => c.query('delete from public.patients where id = $1', [w.patient]), /permission denied/);
    });
  });
});

describe('deleting a course', () => {
  it('removes a course with only cancelled bookings, with its sessions and enrolments', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const slot = await book(c, { ...w, placing: [w.delegate], implants: [{ tooth: 36 }] });
      await c.query("select public.cancel_surgery_slot($1, 'Postponed')", [slot]);

      await c.query('select public.delete_course($1)', [w.course]);

      expect(await count(c, 'select count(*) as n from public.courses where id = $1', w.course)).toBe(0);
      expect(await count(c, 'select count(*) as n from public.sessions where course_id = $1', w.course)).toBe(0);
      expect(await count(c, 'select count(*) as n from public.enrollments where course_id = $1', w.course)).toBe(0);
      expect(await count(c, 'select count(*) as n from public.surgery_slots where id = $1', slot)).toBe(0);
      // The patient's planned implant stays on their chart.
      expect(await count(c, "select count(*) as n from public.implant_sites where patient_id = $1 and state = 'planned'", w.patient)).toBe(1);
    });
  });

  it('refuses a course with a live booking or a placed implant', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const slot = await book(c, { ...w, placing: [w.delegate], implants: [{ tooth: 36 }] });
      await refused(c, () => c.query('select public.delete_course($1)', [w.course]), /Cancel them first/);
      await place(c, { patient: w.patient, tooth: 36, product: w.product, lot: w.lot, delegate: w.delegate, supervisor: w.supervisor, slot });
      await refused(c, () => c.query('select public.delete_course($1)', [w.course]), /Implants were placed in this course/);
    });
  });

  it('cannot be done with a direct delete', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await refused(c, () => c.query('delete from public.courses where id = $1', [w.course]), /permission denied/);
    });
  });
});

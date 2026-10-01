import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs } from './helpers';
import { book, enroll, makeChair, makeCourse, makeDelegate, makePatient, makeProduct, makeSession } from './fixtures';

const users = inject('testUsers');

async function world(c: Client) {
  await actAs(c, users.admin);
  const chair = await makeChair(c);
  const chair2 = await makeChair(c);
  await actAs(c, users.organizer);
  const course = await makeCourse(c);
  const session = await makeSession(c, course);
  const d1 = await makeDelegate(c, 'Dr One');
  const d2 = await makeDelegate(c, 'Dr Two');
  await enroll(c, course, d1);
  await enroll(c, course, d2);
  const patient = await makePatient(c, 'Slot Patient');
  const product = await makeProduct(c);
  return { chair, chair2, course, session, d1, d2, patient, product, supervisor: users.organizer };
}

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

describe('booking a surgery', () => {
  it('stores times in Cairo, delegates with roles, and plans the implants on the chart', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const slot = await book(c, { ...w, placing: [w.d1], assisting: [w.d2], implants: [{ tooth: 36, product_id: w.product }, { tooth: 46 }] });
      const s = await c.query(
        "select to_char(starts_at at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI') as at, status from public.surgery_slots where id = $1",
        [slot],
      );
      expect(s.rows[0]).toEqual({ at: '2030-03-02 09:00', status: 'scheduled' });
      const d = await c.query('select delegate_id, role from public.slot_delegates where slot_id = $1 order by role desc', [slot]);
      expect(d.rows).toEqual([{ delegate_id: w.d1, role: 'placing' }, { delegate_id: w.d2, role: 'assisting' }]);
      const sites = await c.query(
        'select tooth, state, product_id, slot_id, session_id, course_id from public.implant_sites where patient_id = $1 order by tooth',
        [w.patient],
      );
      expect(sites.rows).toEqual([
        { tooth: 36, state: 'planned', product_id: w.product, slot_id: slot, session_id: w.session, course_id: w.course },
        { tooth: 46, state: 'planned', product_id: null, slot_id: slot, session_id: w.session, course_id: w.course },
      ]);
      const teeth = await c.query("select tooth from public.tooth_status where patient_id = $1 and status = 'implant_planned' order by tooth", [w.patient]);
      expect(teeth.rows.map((r) => r.tooth)).toEqual([36, 46]);
    });
  });

  it('links an implant already planned from the chart', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const planned = (await c.query('select public.plan_implant($1, 36::smallint) as id', [w.patient])).rows[0].id;
      const slot = await book(c, { ...w, placing: [w.d1], implants: [{ tooth: 36, product_id: w.product }] });
      const s = await c.query('select slot_id, product_id from public.implant_sites where id = $1', [planned]);
      expect(s.rows[0]).toEqual({ slot_id: slot, product_id: w.product });
    });
  });

  it('refuses bad bookings with specific messages', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const outsider = await makeDelegate(c, 'Dr Outsider');
      const lecture = await makeSession(c, w.course, 'lecture');
      await refused(c, () => book(c, { ...w, session: lecture, placing: [w.d1] }), /only be booked in a surgery session/);
      await refused(c, () => book(c, { ...w, placing: [] }), /at least one placing delegate/);
      await refused(c, () => book(c, { ...w, placing: [outsider] }), /Dr Outsider is not enrolled in this course/);
      await refused(c, () => book(c, { ...w, placing: [w.d1], assisting: [w.d1] }), /both placing and assisting/);
      await refused(c, () => book(c, { ...w, placing: [w.d1], start: '10:00', end: '09:00' }), /end time must be after/);
      await refused(c, () => book(c, { ...w, placing: [w.d1], implants: [{ tooth: 36 }, { tooth: 36 }] }), /Tooth 36 is listed twice/);
      await refused(c, () => book(c, { ...w, placing: [w.d1], implants: [{ tooth: 19 }] }), /19 is not a tooth number/);
    });
  });

  it('clashes are detected per kind', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await book(c, { ...w, placing: [w.d1] });
      const other = await makePatient(c, 'Other Patient');
      const { rows } = await c.query(
        `select kind from public.slot_conflicts($1, $2, '09:30', '10:30', $3, $4, $5::uuid[]) order by kind`,
        [w.session, w.chair, other, w.supervisor, [w.d1]],
      );
      expect(rows.map((r) => r.kind)).toEqual(['chair', 'delegate', 'supervisor']);
      const none = await c.query(
        `select kind from public.slot_conflicts($1, $2, '10:00', '11:00', $3, $4, $5::uuid[])`,
        [w.session, w.chair, other, w.supervisor, [w.d1]],
      );
      expect(none.rows).toEqual([]);
    });
  });

  it('override needs a reason, which is stored', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await book(c, { ...w, placing: [w.d1] });
      const other = await makePatient(c, 'Other Patient');
      await refused(c, () => book(c, { ...w, patient: other, chair: w.chair2, placing: [w.d2] }), /clashes with another surgery/);
      const slot = await book(c, { ...w, patient: other, chair: w.chair2, placing: [w.d2], override: 'Supervisor covers both chairs' });
      const s = await c.query('select override_reason from public.surgery_slots where id = $1', [slot]);
      expect(s.rows[0].override_reason).toBe('Supervisor covers both chairs');
    });
  });

  it('cancelling keeps the planned implants (unlinked) and needs a reason', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const slot = await book(c, { ...w, placing: [w.d1], implants: [{ tooth: 36 }] });
      await refused(c, () => c.query("select public.cancel_surgery_slot($1, ' ')", [slot]), /Explain why/);
      await c.query("select public.cancel_surgery_slot($1, 'Patient unwell')", [slot]);
      const s = await c.query('select status, cancel_reason from public.surgery_slots where id = $1', [slot]);
      expect(s.rows[0]).toEqual({ status: 'cancelled', cancel_reason: 'Patient unwell' });
      const site = await c.query('select state, slot_id from public.implant_sites where patient_id = $1', [w.patient]);
      expect(site.rows).toEqual([{ state: 'planned', slot_id: null }]);
      const clash = await c.query(
        `select kind from public.slot_conflicts($1, $2, '09:00', '10:00', $3, $4, $5::uuid[])`,
        [w.session, w.chair, w.patient, w.supervisor, [w.d1]],
      );
      expect(clash.rows).toEqual([]);
    });
  });

  it('slots_on returns the Cairo day', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const slot = await book(c, { ...w, placing: [w.d1], start: '00:30', end: '01:30' });
      const { rows } = await c.query("select id from public.slots_on('2030-03-02') where id = $1", [slot]);
      expect(rows).toHaveLength(1);
    });
  });

  it('users cannot write booking tables directly', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await refused(
        c,
        () =>
          c.query(
            `insert into public.surgery_slots (session_id, chair_id, starts_at, ends_at, patient_id, supervisor_id)
             values ($1, $2, now(), now() + interval '1 hour', $3, $4)`,
            [w.session, w.chair, w.patient, w.supervisor],
          ),
        /permission denied/,
      );
    });
  });
});

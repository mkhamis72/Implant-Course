import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs } from './helpers';
import { book, enroll, makeChair, makeCourse, makeDelegate, makePatient, makeProduct, makeSession, place, receive } from './fixtures';

const users = inject('testUsers');

async function world(c: Client) {
  await actAs(c, users.admin);
  const chair = await makeChair(c);
  const chair2 = await makeChair(c);
  await actAs(c, users.organizer);
  const course = await makeCourse(c);
  const session = await makeSession(c, course);
  const d1 = await makeDelegate(c, 'Dr Tech One');
  const d2 = await makeDelegate(c, 'Dr Tech Two');
  const d3 = await makeDelegate(c, 'Dr Tech Three');
  await enroll(c, course, d1);
  await enroll(c, course, d2);
  await enroll(c, course, d3);
  const patient = await makePatient(c, 'Zz Technique Patient');
  const product = await makeProduct(c);
  const lot = await receive(c, product, 5, 'TQ-1', '2031-01-01');
  return { chair, chair2, course, session, d1, d2, d3, patient, product, lot, supervisor: users.organizer };
}

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

function edit(
  c: Client,
  a: { slot: string; chair: string; supervisor: string; placing: string[]; assisting?: string[]; start?: string; end?: string; override?: string; notes?: string },
) {
  return c.query(
    `select public.update_surgery_slot(
       p_slot => $1, p_chair => $2, p_start => $3::time, p_end => $4::time, p_supervisor => $5,
       p_placing => $6::uuid[], p_assisting => $7::uuid[], p_override_reason => $8, p_notes => $9)`,
    [a.slot, a.chair, a.start ?? '09:00', a.end ?? '10:00', a.supervisor, a.placing, a.assisting ?? [], a.override ?? '', a.notes ?? ''],
  );
}

async function technique(c: Client, patient: string, tooth: number) {
  const { rows } = await c.query(
    "select technique from public.implant_sites where patient_id = $1 and tooth = $2 and state <> 'removed'",
    [patient, tooth],
  );
  return rows[0]?.technique;
}

describe('implant technique', () => {
  it('is stored when booking, planning and placing, and can be changed', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await book(c, { ...w, placing: [w.d1], implants: [{ tooth: 36, technique: 'guided' }, { tooth: 46 }] });
      expect(await technique(c, w.patient, 36)).toBe('guided');
      expect(await technique(c, w.patient, 46)).toBeNull();

      await c.query("select public.plan_implant(p_patient => $1, p_tooth => 11::smallint, p_technique => 'free_hand')", [w.patient]);
      expect(await technique(c, w.patient, 11)).toBe('free_hand');

      await place(c, { patient: w.patient, tooth: 46, product: w.product, lot: w.lot, delegate: w.d1, supervisor: w.supervisor, technique: 'free_hand' });
      expect(await technique(c, w.patient, 46)).toBe('free_hand');
      // Placing without a technique keeps the planned one.
      await place(c, { patient: w.patient, tooth: 36, product: w.product, lot: w.lot, delegate: w.d1, supervisor: w.supervisor });
      expect(await technique(c, w.patient, 36)).toBe('guided');

      const site = (await c.query('select id from public.implant_sites where patient_id = $1 and tooth = 36', [w.patient])).rows[0].id;
      await c.query("select public.set_implant_technique($1, 'free_hand')", [site]);
      expect(await technique(c, w.patient, 36)).toBe('free_hand');
      await refused(c, () => c.query("select public.set_implant_technique($1, 'robotic')", [site]), /Guided or Free hand/);
      await refused(c, () => book(c, { ...w, start: '11:00', end: '12:00', placing: [w.d1], implants: [{ tooth: 21, technique: 'robotic' }] }), /Guided or Free hand/);
    });
  });

  it('appears in the delegate report', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await place(c, { patient: w.patient, tooth: 36, product: w.product, lot: w.lot, delegate: w.d1, supervisor: w.supervisor, technique: 'guided' });
      const { rows } = await c.query('select tooth, technique from public.delegate_report($1)', [w.d1]);
      expect(rows).toEqual([{ tooth: 36, technique: 'guided' }]);
    });
  });
});

describe('editing a booking', () => {
  it('changes chair, times, supervisor, delegates and notes', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const slot = await book(c, { ...w, placing: [w.d1], assisting: [w.d2] });
      await edit(c, { slot, chair: w.chair2, supervisor: w.supervisor, placing: [w.d2, w.d3], assisting: [w.d1], start: '13:00', end: '14:30', notes: 'Moved' });
      const s = await c.query(
        `select chair_id, notes, to_char(starts_at at time zone 'Africa/Cairo', 'HH24:MI') as s,
                to_char(ends_at at time zone 'Africa/Cairo', 'HH24:MI') as e
         from public.surgery_slots where id = $1`,
        [slot],
      );
      expect(s.rows[0]).toEqual({ chair_id: w.chair2, notes: 'Moved', s: '13:00', e: '14:30' });
      const d = await c.query('select delegate_id, role from public.slot_delegates where slot_id = $1', [slot]);
      expect(d.rows).toHaveLength(3);
      expect(d.rows).toEqual(expect.arrayContaining([
        { delegate_id: w.d2, role: 'placing' }, { delegate_id: w.d3, role: 'placing' }, { delegate_id: w.d1, role: 'assisting' },
      ]));
    });
  });

  it('ignores the booking itself when checking clashes, and needs a reason for a real clash', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const slot = await book(c, { ...w, placing: [w.d1] });
      await edit(c, { slot, chair: w.chair, supervisor: w.supervisor, placing: [w.d1], start: '09:15', end: '10:15' });
      const other = await makePatient(c, 'Zz Other Technique Patient');
      await book(c, { ...w, patient: other, chair: w.chair2, placing: [w.d2], start: '11:00', end: '12:00' });
      await refused(c, () => edit(c, { slot, chair: w.chair2, supervisor: w.supervisor, placing: [w.d1], start: '11:30', end: '12:30' }), /clashes/);
      await edit(c, { slot, chair: w.chair2, supervisor: w.supervisor, placing: [w.d1], start: '11:30', end: '12:30', override: 'Short case' });
      const r = await c.query('select override_reason from public.surgery_slots where id = $1', [slot]);
      expect(r.rows[0].override_reason).toBe('Short case');
    });
  });

  it('refuses bad edits and bookings that are not scheduled', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const outsider = await makeDelegate(c, 'Dr Tech Outsider');
      const slot = await book(c, { ...w, placing: [w.d1] });
      await refused(c, () => edit(c, { slot, chair: w.chair, supervisor: w.supervisor, placing: [] }), /at least one placing delegate/);
      await refused(c, () => edit(c, { slot, chair: w.chair, supervisor: w.supervisor, placing: [outsider] }), /Dr Tech Outsider is not enrolled/);
      await refused(c, () => edit(c, { slot, chair: w.chair, supervisor: w.supervisor, placing: [w.d1], start: '10:00', end: '09:00' }), /end time must be after/);
      await c.query("select public.set_slot_status($1, 'done')", [slot]);
      await refused(c, () => edit(c, { slot, chair: w.chair, supervisor: w.supervisor, placing: [w.d1] }), /Only scheduled surgeries can be edited/);
      await c.query("select public.set_slot_status($1, 'scheduled')", [slot]);
      await c.query("select public.cancel_surgery_slot($1, 'Patient ill')", [slot]);
      await refused(c, () => edit(c, { slot, chair: w.chair, supervisor: w.supervisor, placing: [w.d1] }), /Only scheduled surgeries can be edited/);
    });
  });
});

describe('completing a booking by hand', () => {
  it('marks completed and reopens, and refuses other changes', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const slot = await book(c, { ...w, placing: [w.d1] });
      await refused(c, () => c.query("select public.set_slot_status($1, 'scheduled')", [slot]), /Only completed surgeries can be reopened/);
      await c.query("select public.set_slot_status($1, 'done')", [slot]);
      expect((await c.query('select status from public.surgery_slots where id = $1', [slot])).rows[0].status).toBe('done');
      await refused(c, () => c.query("select public.set_slot_status($1, 'cancelled')", [slot]), /Only scheduled surgeries can be marked completed|reopened/);
      await c.query("select public.set_slot_status($1, 'scheduled')", [slot]);
      expect((await c.query('select status from public.surgery_slots where id = $1', [slot])).rows[0].status).toBe('scheduled');
    });
  });
});

import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs } from './helpers';
import { book, enroll, makeChair, makeCourse, makeDelegate, makePatient, makeProduct, makeSession, place, receive } from './fixtures';

const users = inject('testUsers');

async function booked(c: Client) {
  await actAs(c, users.admin);
  const chair = await makeChair(c);
  await actAs(c, users.organizer);
  const course = await makeCourse(c);
  const session = await makeSession(c, course);
  const delegate = await makeDelegate(c, 'Dr Report');
  await enroll(c, course, delegate);
  const patient = await makePatient(c, 'Booked Patient');
  const product = await makeProduct(c);
  const lot = await receive(c, product, 5, 'PL-1', '2031-01-01');
  const slot = await book(c, {
    session, chair, patient, supervisor: users.organizer, placing: [delegate],
    implants: [{ tooth: 36, product_id: product }, { tooth: 46, product_id: product }, { tooth: 11 }],
  });
  return { course, session, delegate, patient, product, lot, slot };
}

describe('placing from a booking', () => {
  it('records course, session and booking; the booking is done when nothing is left planned', async () => {
    await withTx(async (c) => {
      const b = await booked(c);
      const args = { patient: b.patient, product: b.product, lot: b.lot, delegate: b.delegate, supervisor: users.organizer, slot: b.slot };
      const site = await place(c, { ...args, tooth: 36 });
      const s = await c.query('select course_id, session_id, slot_id from public.implant_sites where id = $1', [site]);
      expect(s.rows[0]).toEqual({ course_id: b.course, session_id: b.session, slot_id: b.slot });
      await place(c, { ...args, tooth: 46 });
      expect((await c.query('select status from public.surgery_slots where id = $1', [b.slot])).rows[0].status).toBe('scheduled');
      await place(c, { ...args, tooth: 11 });
      expect((await c.query('select status from public.surgery_slots where id = $1', [b.slot])).rows[0].status).toBe('done');
    });
  });

  it('a planned implant linked to a booking keeps the link when placed from the chart', async () => {
    await withTx(async (c) => {
      const b = await booked(c);
      const site = await place(c, { patient: b.patient, product: b.product, lot: b.lot, delegate: b.delegate, supervisor: users.organizer, tooth: 36, course: b.course });
      const s = await c.query('select slot_id, course_id from public.implant_sites where id = $1', [site]);
      expect(s.rows[0]).toEqual({ slot_id: b.slot, course_id: b.course });
    });
  });

  it('refuses a booking of another patient', async () => {
    await withTx(async (c) => {
      const b = await booked(c);
      const other = await makePatient(c, 'Other');
      await expect(
        place(c, { patient: other, product: b.product, lot: b.lot, delegate: b.delegate, supervisor: users.organizer, tooth: 36, slot: b.slot }),
      ).rejects.toThrow(/booking is for another patient/);
    });
  });

  it('a tooth with a placed implant cannot be booked', async () => {
    await withTx(async (c) => {
      const b = await booked(c);
      await place(c, { patient: b.patient, product: b.product, lot: b.lot, delegate: b.delegate, supervisor: users.organizer, tooth: 36 });
      await actAs(c, users.admin);
      const chair2 = await makeChair(c);
      await actAs(c, users.organizer);
      await expect(
        book(c, { session: b.session, chair: chair2, patient: b.patient, supervisor: users.organizer, placing: [b.delegate], implants: [{ tooth: 36 }], start: '14:00', end: '15:00' }),
      ).rejects.toThrow(/Tooth 36 already has an implant/);
    });
  });
});

describe('pull list', () => {
  it('sums still-planned implants per product for the Cairo day against usable stock', async () => {
    await withTx(async (c) => {
      const b = await booked(c);
      const { rows } = await c.query("select product_id, needed, available from public.pull_list('2030-03-02') order by product_id nulls last");
      expect(rows).toEqual([
        { product_id: b.product, needed: 2, available: 5 },
        { product_id: null, needed: 1, available: 0 },
      ]);
      await place(c, { patient: b.patient, product: b.product, lot: b.lot, delegate: b.delegate, supervisor: users.organizer, tooth: 36 });
      const after = await c.query("select needed, available from public.pull_list('2030-03-02') where product_id = $1", [b.product]);
      expect(after.rows).toEqual([{ needed: 1, available: 4 }]);
    });
  });
});

describe('delegate report', () => {
  it('lists placed and assisted implants with course and last outcome', async () => {
    await withTx(async (c) => {
      const b = await booked(c);
      const assistant = await makeDelegate(c, 'Dr Assistant');
      const site = await place(c, {
        patient: b.patient, product: b.product, lot: b.lot, delegate: b.delegate, supervisor: users.organizer,
        tooth: 36, slot: b.slot, assistant,
      });
      await c.query("select public.record_visit($1, public.cairo_today(), null, '2-week', 'attended', 'ok', '{}'::jsonb, '')", [site]);
      const mine = await c.query('select role, course_name, tooth, state, lot_no, last_outcome from public.delegate_report($1)', [b.delegate]);
      expect(mine.rows).toEqual([{ role: 'placing', course_name: 'Test Course', tooth: 36, state: 'placed', lot_no: 'PL-1', last_outcome: 'ok' }]);
      const theirs = await c.query('select role from public.delegate_report($1)', [assistant]);
      expect(theirs.rows).toEqual([{ role: 'assisting' }]);
    });
  });
});

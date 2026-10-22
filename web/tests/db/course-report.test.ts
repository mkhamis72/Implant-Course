import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs } from './helpers';
import { book, enroll, makeChair, makeCourse, makeDelegate, makePatient, makeProduct, makeSession, place, receive } from './fixtures';

const users = inject('testUsers');

async function world(c: Client) {
  await actAs(c, users.admin);
  const chair = await makeChair(c);
  await actAs(c, users.organizer);
  const course = await makeCourse(c, '2030-03-01', '2030-03-05');
  const session = await makeSession(c, course, 'surgery', '2030-03-02');
  const d1 = await makeDelegate(c, 'Zz Report Placer');
  const d2 = await makeDelegate(c, 'Zz Report Assistant');
  await enroll(c, course, d1);
  await enroll(c, course, d2);
  const product = await makeProduct(c);
  const lot = await receive(c, product, 10, 'ZZREP');
  return { chair, course, session, d1, d2, product, lot };
}

describe('retired placement functions', () => {
  it('place_implant, place_implant_v2 and correct_placement are gone (0052, 0063)', async () => {
    await withTx(async (c) => {
      for (const f of ['place_implant', 'place_implant_v2', 'correct_placement']) {
        expect((await c.query('select to_regproc($1) as f', ['public.' + f])).rows[0].f).toBeNull();
      }
    });
  });
});

describe('course_report', () => {
  it('lists placed implants with delegates, supervisor, product and measurements; skips planned ones', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const p1 = await makePatient(c, 'Zz Report One');
      const p2 = await makePatient(c, 'Zz Report Two');
      const slot = await book(c, {
        session: w.session, chair: w.chair, patient: p1, supervisor: users.organizer, placing: [w.d1], assisting: [w.d2],
        implants: [{ tooth: 36 }, { tooth: 46 }],
      });
      await place(c, {
        patient: p1, tooth: 36, product: w.product, lot: w.lot, delegate: w.d1, assistant: w.d2, supervisor: users.organizer,
        slot, technique: 'guided', torque: 40, isq: 70, boneType: 'D3', placedOn: '2026-01-10',
      });
      await book(c, {
        session: w.session, chair: w.chair, patient: p2, supervisor: users.organizer, placing: [w.d2], implants: [{ tooth: 11 }],
        start: '11:00', end: '12:00',
      });
      const { rows } = await c.query('select * from public.course_report($1)', [w.course]);
      expect(rows).toHaveLength(1); // tooth 46 of p1 and tooth 11 of p2 are still planned
      expect(rows[0]).toMatchObject({
        session_title: 'Test Session', patient_name: 'Zz Report One', tooth: 36, state: 'placed',
        placing_delegate: 'Zz Report Placer', assisting_delegate: 'Zz Report Assistant', supervisor: 'Test Organizer',
        brand: 'Test Brand', lot_no: 'ZZREP', technique: 'guided', bone_type: 'D3',
      });
      expect(Number(rows[0].torque_ncm)).toBe(40);
      expect(Number(rows[0].isq)).toBe(70);
    });
  });

  it('keeps failed implants and leaves removed ones out', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const p = await makePatient(c, 'Zz Report States');
      const slot = await book(c, { session: w.session, chair: w.chair, patient: p, supervisor: users.organizer, placing: [w.d1], implants: [{ tooth: 36 }, { tooth: 46 }] });
      const failed = await place(c, { patient: p, tooth: 36, product: w.product, lot: w.lot, delegate: w.d1, supervisor: users.organizer, slot, placedOn: '2026-01-10' });
      const removed = await place(c, { patient: p, tooth: 46, product: w.product, lot: w.lot, delegate: w.d1, supervisor: users.organizer, slot, placedOn: '2026-01-10' });
      await c.query('reset role');
      await c.query(`update public.implant_sites set state = 'failed' where id = $1`, [failed]);
      await c.query(`update public.implant_sites set state = 'removed' where id = $1`, [removed]);
      await actAs(c, users.organizer);
      const { rows } = await c.query('select tooth, state from public.course_report($1) order by tooth', [w.course]);
      expect(rows).toEqual([{ tooth: 36, state: 'failed' }]);
    });
  });

  it('includes unlinked placements by enrolled delegates within the course dates only', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const outsider = await makeDelegate(c, 'Zz Report Outsider');
      const p = await makePatient(c, 'Zz Report Unlinked');
      // Placement must be today or earlier, so unlinked placements need a course in the past.
      const past = await makeCourse(c, '2026-01-05', '2026-01-15');
      await enroll(c, past, w.d1);
      await place(c, { patient: p, tooth: 36, product: w.product, lot: w.lot, delegate: w.d1, supervisor: users.organizer, course: past, placedOn: '2026-01-10' });
      await place(c, { patient: p, tooth: 46, product: w.product, lot: w.lot, delegate: w.d1, supervisor: users.organizer, course: past, placedOn: '2026-01-20' });
      await place(c, { patient: p, tooth: 11, product: w.product, lot: w.lot, delegate: outsider, supervisor: users.organizer, course: past, placedOn: '2026-01-10' });
      // Older placements have no course: they are matched by date and enrollment.
      await c.query('reset role');
      await c.query('update public.implant_sites set course_id = null where patient_id = $1', [p]);
      await actAs(c, users.organizer);
      const { rows } = await c.query('select tooth, session_id from public.course_report($1) order by tooth', [past]);
      expect(rows).toEqual([{ tooth: 36, session_id: null }]);
    });
  });

  it('shows nothing to an organizer without Patients or Schedule view', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const p = await makePatient(c, 'Zz Report Hidden');
      const slot = await book(c, { session: w.session, chair: w.chair, patient: p, supervisor: users.organizer, placing: [w.d1], implants: [{ tooth: 36 }] });
      await place(c, { patient: p, tooth: 36, product: w.product, lot: w.lot, delegate: w.d1, supervisor: users.organizer, slot, placedOn: '2026-01-10' });
      const visible = await c.query('select count(*)::int as n from public.course_report($1)', [w.course]);
      expect(visible.rows[0].n).toBe(1);
      await c.query('reset role');
      await c.query('delete from public.user_permissions where user_id = $1', [users.target]);
      await c.query(`insert into public.user_permissions values ($1, 'courses', 'view')`, [users.target]);
      await actAs(c, users.target);
      const { rows } = await c.query('select count(*)::int as n from public.course_report($1)', [w.course]);
      expect(rows[0].n).toBe(0);
    });
  });
});

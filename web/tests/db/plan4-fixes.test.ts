import { describe, it, expect, inject } from 'vitest';
import { Client } from 'pg';
import { pgConfig } from '../../scripts/db';
import { withTx, actAs, asPostgres } from './helpers';
import { book, enroll, makeChair, makeCourse, makeDelegate, makePatient, makeProduct, makeSession, onHand, place, receive } from './fixtures';

const users = inject('testUsers');

async function world(c: Client) {
  await actAs(c, users.admin);
  const chair = await makeChair(c);
  await actAs(c, users.organizer);
  const course = await makeCourse(c, '2030-03-01', '2030-03-05');
  const day1 = await makeSession(c, course, 'surgery', '2030-03-02');
  const day2 = await makeSession(c, course, 'surgery', '2030-03-03');
  const d1 = await makeDelegate(c, 'Dr Fix One');
  await enroll(c, course, d1);
  const patient = await makePatient(c, 'Fix Patient');
  return { chair, course, day1, day2, d1, patient, supervisor: users.organizer };
}

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

describe('I1: concurrent bookings are serialised per day', () => {
  it('a clashing booking waits for the first one instead of slipping through', async () => {
    const setup = new Client(pgConfig());
    const a = new Client(pgConfig());
    const b = new Client(pgConfig());
    await Promise.all([setup.connect(), a.connect(), b.connect()]);
    let chair = '';
    try {
      await setup.query('begin');
      const w = await world(setup);
      chair = w.chair;
      const other = await makePatient(setup, 'E2E Race Other');
      await setup.query('commit');

      await a.query('begin');
      await actAs(a, users.organizer);
      await book(a, { session: w.day1, chair: w.chair, patient: w.patient, supervisor: w.supervisor, placing: [w.d1] });

      await b.query('begin');
      await actAs(b, users.organizer);
      await b.query("set local statement_timeout = '2s'");
      await expect(
        book(b, { session: w.day1, chair: w.chair, patient: other, supervisor: w.supervisor, placing: [w.d1] }),
      ).rejects.toThrow(/statement timeout/);
    } finally {
      await a.query('rollback').catch(() => {});
      await b.query('rollback').catch(() => {});
      if (chair) {
        await asPostgres(setup).catch(() => {});
        await setup.query('update public.chairs set active = false where id = $1', [chair]).catch(() => {});
      }
      await Promise.all([setup.end(), a.end(), b.end()]);
    }
  });
});

describe('I2/I4: specific refusals', () => {
  it('a tooth already booked in another active booking is refused, not silently moved', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await book(c, { session: w.day1, chair: w.chair, patient: w.patient, supervisor: w.supervisor, placing: [w.d1], implants: [{ tooth: 36 }] });
      await refused(
        c,
        () => book(c, { session: w.day2, chair: w.chair, patient: w.patient, supervisor: w.supervisor, placing: [w.d1], implants: [{ tooth: 36 }] }),
        /Tooth 36 is already booked on 2030-03-02/,
      );
    });
  });

  it('after cancelling, the tooth can be booked again and the pull list counts it once', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const product = await makeProduct(c);
      const first = await book(c, {
        session: w.day1, chair: w.chair, patient: w.patient, supervisor: w.supervisor, placing: [w.d1],
        implants: [{ tooth: 36, product_id: product }],
      });
      await c.query("select public.cancel_surgery_slot($1, 'Moved to day 2')", [first]);
      await book(c, {
        session: w.day2, chair: w.chair, patient: w.patient, supervisor: w.supervisor, placing: [w.d1],
        implants: [{ tooth: 36, product_id: product }],
      });
      const d1 = await c.query("select needed from public.pull_list('2030-03-02') where product_id = $1", [product]);
      const d2 = await c.query("select needed from public.pull_list('2030-03-03') where product_id = $1", [product]);
      expect(d1.rows).toEqual([]);
      expect(d2.rows).toEqual([{ needed: 1 }]);
    });
  });

  it('the same delegate listed twice gets a specific message', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await refused(
        c,
        () => book(c, { session: w.day1, chair: w.chair, patient: w.patient, supervisor: w.supervisor, placing: [w.d1, w.d1] }),
        /A delegate is listed twice/,
      );
    });
  });
});

describe('I3: correcting to the batch actually used', () => {
  it('works even if that batch has expired since the surgery', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const patient = await makePatient(c);
      const implant = await makeProduct(c);
      const wrong = await receive(c, implant, 1, 'PA');
      const delegate = await makeDelegate(c);
      const placedOn = (await c.query('select (current_date - 30)::text as d')).rows[0].d;
      const site = await place(c, { patient, tooth: 36, product: implant, lot: wrong, delegate, supervisor: users.organizer, placedOn });
      const right = (
        await c.query(
          "select public.receive_stock(p_product => $1, p_qty => 1, p_lot_no => 'PB', p_expiry => current_date - 1, p_received_on => current_date - 60) as id",
          [implant],
        )
      ).rows[0].id;
      await c.query("select public.correct_batch($1, $2, 'Recall audit found PB')", [site, right]);
      expect(await onHand(c, right)).toBe(0);
      expect(await onHand(c, wrong)).toBe(1);
    });
  });

  it('still refuses a batch that had already expired on the day of surgery', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const patient = await makePatient(c);
      const implant = await makeProduct(c);
      const wrong = await receive(c, implant, 1, 'PA');
      const delegate = await makeDelegate(c);
      const site = await place(c, { patient, tooth: 36, product: implant, lot: wrong, delegate, supervisor: users.organizer });
      const old = await receive(c, implant, 1, 'OLD', '2020-01-01');
      await expect(c.query("select public.correct_batch($1, $2, 'Wrong one')", [site, old])).rejects.toThrow(
        /had expired on 2020-01-01/,
      );
    });
  });
});

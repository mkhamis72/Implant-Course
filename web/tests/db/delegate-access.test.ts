import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import {
  addTalk, book, enroll, makeChair, makeCourse, makeDelegate, makeLecturer, makePatient, makeProduct, makeSession, place, receive,
} from './fixtures';

const users = inject('testUsers');

/** Turns the `target` test user into a delegate login for a fresh delegate, inside the transaction. */
async function asDelegate(c: Client): Promise<string> {
  await asPostgres(c);
  const me = await makeDelegate(c, 'Zz Me Delegate');
  await c.query(`update public.profiles set role = 'delegate', delegate_id = $2, active = true where user_id = $1`, [users.target, me]);
  return me;
}

async function world(c: Client) {
  await actAs(c, users.admin);
  const chair = await makeChair(c);
  const lecturer = await makeLecturer(c, 'Zz Prof Delegate View');
  await actAs(c, users.organizer);
  const course = await makeCourse(c);
  const other = await makeCourse(c);
  const surgery = await makeSession(c, course);
  const lecture = await makeSession(c, course, 'lecture');
  const otherLecture = await makeSession(c, other, 'lecture');
  const someoneElse = await makeDelegate(c, 'Zz Someone Else');
  await enroll(c, course, someoneElse);
  const p1 = await makePatient(c, 'Zz Mine Patient');
  const p2 = await makePatient(c, 'Zz Other Patient');
  return { chair, lecturer, course, other, surgery, lecture, otherLecture, someoneElse, p1, p2 };
}

describe('delegate logins', () => {
  it('see no table rows except their own profile and permission rows', async () => {
    await withTx(async (c) => {
      await asDelegate(c);
      const { rows: tables } = await c.query(`select tablename from pg_tables where schemaname = 'public' order by 1`);
      await actAs(c, users.target);
      for (const { tablename } of tables) {
        await c.query('savepoint s');
        try {
          const r = await c.query(`select count(*)::int as n from public.${tablename}`);
          // their own profile; settings holds only the idle timeout and expiry alert days
          if (tablename === 'profiles' || tablename === 'settings') expect({ tablename, n: r.rows[0].n }).toEqual({ tablename, n: 1 });
          else if (tablename !== 'user_permissions') expect({ tablename, n: r.rows[0].n }).toEqual({ tablename, n: 0 });
        } catch (e) {
          expect((e as Error).message).toMatch(/permission denied/);
        }
        await c.query('rollback to savepoint s');
      }
    });
  }, 120_000); // one round-trip per public table against the hosted dev project

  it('cannot call staff write functions', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await asDelegate(c);
      await actAs(c, users.target);
      for (const [sql, params] of [
        ['select public.create_talk($1, $2::time, $3::time, $4, $5)', [w.lecture, '09:00', '10:00', w.lecturer, 'Nope']],
        ['select public.plan_implant($1, 36::smallint)', [w.p1]],
        ['select public.delete_course($1)', [w.course]],
      ] as [string, unknown[]][]) {
        await c.query('savepoint s');
        // require_active() refuses non-staff with "Not allowed" before any permission check.
        await expect(c.query(sql, params)).rejects.toThrow(/^Not allowed$/);
        await c.query('rollback to savepoint s');
      }
    });
  });

  it('my_schedule: my bookings and my courses’ talks only; my_report: my implants only', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const me = await asDelegate(c);
      await actAs(c, users.organizer);
      await enroll(c, w.course, me);
      await book(c, { session: w.surgery, chair: w.chair, patient: w.p1, supervisor: users.organizer, placing: [me], implants: [{ tooth: 36 }] });
      await book(c, { session: w.surgery, chair: w.chair, patient: w.p2, supervisor: users.organizer, placing: [w.someoneElse], start: '11:00', end: '12:00' });
      await addTalk(c, { session: w.lecture, lecturer: w.lecturer, start: '13:00', end: '14:00', topic: 'Mine talk' });
      await addTalk(c, { session: w.otherLecture, lecturer: w.lecturer, start: '15:00', end: '16:00', topic: 'Other course talk' });
      const product = await makeProduct(c);
      const lot = await receive(c, product, 1, 'ZZDEL');
      await place(c, { patient: w.p1, tooth: 46, product, lot, delegate: me, supervisor: users.organizer, technique: 'guided' });

      await actAs(c, users.target);
      const s = await c.query(
        `select kind, title, my_role, patient_name, teeth from public.my_schedule('2030-03-01', '2030-03-05') order by starts_at`,
      );
      expect(s.rows).toEqual([
        { kind: 'surgery', title: 'Test Session', my_role: 'placing', patient_name: 'Zz Mine Patient', teeth: '36' },
        { kind: 'lecture', title: 'Mine talk', my_role: null, patient_name: null, teeth: null },
      ]);
      const r = await c.query('select patient_name, tooth, role from public.my_report()');
      expect(r.rows).toEqual([{ patient_name: 'Zz Mine Patient', tooth: 46, role: 'placing' }]);

      await asPostgres(c);
      await c.query('update public.profiles set active = false where user_id = $1', [users.target]);
      await actAs(c, users.target);
      await c.query('savepoint s');
      await expect(c.query(`select * from public.my_schedule('2030-03-01', '2030-03-05')`)).rejects.toThrow(/delegate logins/);
      await c.query('rollback to savepoint s');
      await expect(c.query('select * from public.my_report()')).rejects.toThrow(/delegate logins/);
    });
  });

  it('staff cannot call the delegate readers', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await expect(c.query('select * from public.my_report()')).rejects.toThrow(/delegate logins/);
    });
  });
});

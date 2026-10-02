import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs } from './helpers';
import { enroll, makeChair, makeCourse, makeDelegate, makeSession } from './fixtures';

const users = inject('testUsers');

async function refused(c: Client, sql: string, params: unknown[], pattern: RegExp) {
  await c.query('savepoint s');
  await expect(c.query(sql, params)).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

describe('courses and sessions', () => {
  it('organizers create courses, sessions and enrollments', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const course = await makeCourse(c);
      const session = await makeSession(c, course);
      const delegate = await makeDelegate(c);
      await enroll(c, course, delegate);
      const { rows } = await c.query('select type, created_by from public.sessions where id = $1', [session]);
      expect(rows[0]).toEqual({ type: 'surgery', created_by: users.organizer });
      await refused(c, 'insert into public.enrollments (course_id, delegate_id) values ($1, $2)', [course, delegate], /duplicate key/);
      await c.query('delete from public.enrollments where course_id = $1 and delegate_id = $2', [course, delegate]);
    });
  });

  it('refuses inverted dates and sessions outside the course', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await refused(c, "insert into public.courses (name, start_date, end_date) values ('Bad', '2030-03-05', '2030-03-01')", [], /courses_dates/);
      const course = await makeCourse(c);
      await expect(makeSession(c, course, 'surgery', '2030-04-01')).rejects.toThrow(/must fall within the course dates/);
    });
  });

  it('courses and sessions cannot be deleted; creator cannot be forged', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const course = await makeCourse(c);
      await refused(c, 'delete from public.courses where id = $1', [course], /permission denied/);
      await refused(c, "insert into public.courses (name, start_date, end_date, created_by) values ('X', '2030-01-01', '2030-01-02', $1)", [users.admin], /permission denied/);
    });
  });
});

describe('chairs', () => {
  it('only admins add or change chairs; organizers can see them', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      const chair = await makeChair(c, 'Zz Chair A');
      await actAs(c, users.organizer);
      expect((await c.query('select name from public.chairs where id = $1', [chair])).rows).toEqual([{ name: 'Zz Chair A' }]);
      await refused(c, "insert into public.chairs (name) values ('Zz Chair B')", [], /row-level security/);
      const r = await c.query("update public.chairs set name = 'Hacked' where id = $1", [chair]);
      expect(r.rowCount).toBe(0);
    });
  });

  it('inactive users see no courses or chairs', async () => {
    await withTx(async (c) => {
      await actAs(c, users.inactive);
      expect((await c.query('select id from public.courses limit 1')).rows).toHaveLength(0);
      expect((await c.query('select id from public.chairs limit 1')).rows).toHaveLength(0);
    });
  });
});

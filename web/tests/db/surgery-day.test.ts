import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs } from './helpers';
import { makeCourse, setPerms } from './fixtures';

const users = inject('testUsers');

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

const add = (c: Client, course: string, a: { date?: string; title?: string; start?: string; end?: string; room?: string | null } = {}) =>
  c
    .query<{ id: string }>('select public.add_surgery_session($1, $2::date, $3, $4::time, $5::time, $6) as id', [
      course, a.date ?? '2030-03-02', a.title ?? 'Surgery day', a.start ?? '08:00', a.end ?? '17:00', a.room ?? null,
    ])
    .then((r) => r.rows[0].id);

describe('add_surgery_session', () => {
  it('lets a Schedule-only editor add a surgery session, always of type surgery', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const course = await makeCourse(c);
      await setPerms(c, users.target, { schedule: 'edit', courses: 'view' });
      await actAs(c, users.target);
      const id = await add(c, course, { title: '  Surgery day  ', room: ' Theatre 2 ' });
      const { rows } = await c.query(
        `select type, title, date::text, start_time::text, end_time::text, room, course_id from public.sessions where id = $1`,
        [id],
      );
      expect(rows[0]).toEqual({
        type: 'surgery', title: 'Surgery day', date: '2030-03-02', start_time: '08:00:00', end_time: '17:00:00', room: 'Theatre 2', course_id: course,
      });
    });
  });

  it('refuses users without Edit on Schedule, including Courses editors', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const course = await makeCourse(c);
      await setPerms(c, users.target, { schedule: 'view', courses: 'edit' });
      await actAs(c, users.target);
      await refused(c, () => add(c, course), /permission/i);
      await actAs(c, users.delegate);
      await refused(c, () => add(c, course), /./);
    });
  });

  it('refuses a date outside the course, bad times, a blank title and a missing course', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const course = await makeCourse(c);
      await refused(c, () => add(c, course, { date: '2030-04-01' }), /The session date must fall within the course dates/);
      await refused(c, () => add(c, course, { start: '10:00', end: '10:00' }), /The session must end after it starts/);
      await refused(c, () => add(c, course, { title: ' x ' }), /Enter the session title/);
      await refused(c, () => add(c, '00000000-0000-0000-0000-000000000000'), /Course not found/);
    });
  });
});

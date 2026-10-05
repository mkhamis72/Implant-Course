import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { addTalk, makeCourse, makeLecturer, makeSession } from './fixtures';

const users = inject('testUsers');

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

async function world(c: Client) {
  await actAs(c, users.admin);
  const l1 = await makeLecturer(c, 'Zz Prof One');
  const l2 = await makeLecturer(c, 'Zz Prof Two');
  await actAs(c, users.organizer);
  const course = await makeCourse(c);
  const lecture = await makeSession(c, course, 'lecture'); // 2030-03-02 08:00–17:00
  const lecture2 = await makeSession(c, course, 'lecture');
  const workshop = await makeSession(c, course, 'workshop');
  const surgery = await makeSession(c, course, 'surgery');
  return { l1, l2, course, lecture, lecture2, workshop, surgery };
}

const update = (c: Client, talk: string, a: { start: string; end: string; lecturer: string; topic?: string }) =>
  c.query('select public.update_talk($1, $2::time, $3::time, $4, $5, $6)', [talk, a.start, a.end, a.lecturer, a.topic ?? 'Updated topic', '']);

describe('talks', () => {
  it('stores a talk in Cairo time in lecture and workshop sessions', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const t = await addTalk(c, { session: w.lecture, lecturer: w.l1, start: '09:00', end: '10:30', topic: '  Bone grafting  ' });
      await addTalk(c, { session: w.workshop, lecturer: w.l2 });
      const { rows } = await c.query(
        `select to_char(starts_at at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI') as at,
                to_char(ends_at at time zone 'Africa/Cairo', 'HH24:MI') as till, topic, lecturer_id
         from public.talks where id = $1`,
        [t],
      );
      expect(rows[0]).toEqual({ at: '2030-03-02 09:00', till: '10:30', topic: 'Bone grafting', lecturer_id: w.l1 });
    });
  });

  it('refuses surgery sessions, bad times, times outside the session and a blank topic', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await refused(c, () => addTalk(c, { session: w.surgery, lecturer: w.l1 }), /Choose a lecture or workshop session/);
      await refused(c, () => addTalk(c, { session: w.lecture, lecturer: w.l1, start: '10:00', end: '10:00' }), /End time must be after the start time/);
      await refused(c, () => addTalk(c, { session: w.lecture, lecturer: w.l1, start: '07:30', end: '09:00' }), /must fit within the session \(08:00–17:00\)/);
      await refused(c, () => addTalk(c, { session: w.lecture, lecturer: w.l1, start: '16:30', end: '17:30' }), /must fit within the session/);
      await refused(c, () => addTalk(c, { session: w.lecture, lecturer: w.l1, topic: ' x ' }), /Enter a topic/);
    });
  });

  it('refuses overlapping talks in one session; back-to-back talks are allowed', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await addTalk(c, { session: w.lecture, lecturer: w.l1, start: '09:00', end: '10:00', topic: 'Flap design' });
      await refused(
        c,
        () => addTalk(c, { session: w.lecture, lecturer: w.l2, start: '09:30', end: '10:30' }),
        /Another talk in this session overlaps \(09:00–10:00, Flap design\)/,
      );
      await addTalk(c, { session: w.lecture, lecturer: w.l2, start: '10:00', end: '11:00' });
    });
  });

  it('refuses a lecturer booked in two places at once', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await addTalk(c, { session: w.lecture, lecturer: w.l1, start: '09:00', end: '10:00' });
      await refused(
        c,
        () => addTalk(c, { session: w.lecture2, lecturer: w.l1, start: '09:30', end: '10:00' }),
        /Zz Prof One is already giving a talk at 09:00–10:00/,
      );
      await addTalk(c, { session: w.lecture2, lecturer: w.l2, start: '09:30', end: '10:00' });
    });
  });

  it('update excludes the talk itself and keeps the session', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const t = await addTalk(c, { session: w.lecture, lecturer: w.l1, start: '09:00', end: '10:00' });
      await update(c, t, { start: '09:15', end: '10:15', lecturer: w.l1, topic: 'Moved' });
      const { rows } = await c.query(
        `select to_char(starts_at at time zone 'Africa/Cairo', 'HH24:MI') as at, topic, session_id from public.talks where id = $1`,
        [t],
      );
      expect(rows[0]).toEqual({ at: '09:15', topic: 'Moved', session_id: w.lecture });
      const other = await addTalk(c, { session: w.lecture, lecturer: w.l2, start: '11:00', end: '12:00' });
      await refused(c, () => update(c, other, { start: '10:00', end: '11:00', lecturer: w.l2 }), /Another talk in this session overlaps/);
      await refused(c, () => update(c, '00000000-0000-0000-0000-000000000000', { start: '09:00', end: '10:00', lecturer: w.l1 }), /Talk not found/);
    });
  });

  it('inactive lecturer: refused on a new talk, kept when editing a talk that has them', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const t = await addTalk(c, { session: w.lecture, lecturer: w.l1 });
      await asPostgres(c);
      await c.query('update public.lecturers set active = false where id = any($1)', [[w.l1, w.l2]]);
      await actAs(c, users.organizer);
      await refused(c, () => addTalk(c, { session: w.lecture, lecturer: w.l1, start: '11:00', end: '12:00' }), /Choose an active lecturer/);
      await update(c, t, { start: '09:00', end: '10:00', lecturer: w.l1 });
      await refused(c, () => update(c, t, { start: '09:00', end: '10:00', lecturer: w.l2 }), /Choose an active lecturer/);
    });
  });

  it('delete_talk removes a talk; deleting the course removes its talks', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const t = await addTalk(c, { session: w.lecture, lecturer: w.l1 });
      await c.query('select public.delete_talk($1)', [t]);
      await refused(c, () => c.query('select public.delete_talk($1)', [t]), /Talk not found/);
      await addTalk(c, { session: w.lecture, lecturer: w.l1 });
      await c.query('select public.delete_course($1)', [w.course]);
      await asPostgres(c);
      const { rows } = await c.query(
        'select count(*)::int as n from public.talks t join public.sessions s on s.id = t.session_id where s.course_id = $1',
        [w.course],
      );
      expect(rows[0].n).toBe(0);
    });
  });

  it('privileges: only admins write lecturers; talks are written only through the functions', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await refused(c, () => c.query(`insert into public.lecturers (full_name) values ('Zz Nope')`), /row-level security/);
      await refused(
        c,
        () =>
          c.query(
            `insert into public.talks (session_id, starts_at, ends_at, lecturer_id, topic) values ($1, now(), now() + interval '1 hour', $2, 'Direct')`,
            [w.lecture, w.l1],
          ),
        /permission denied/,
      );
      const t = await addTalk(c, { session: w.lecture, lecturer: w.l1 });
      await refused(c, () => c.query(`update public.talks set topic = 'Hack' where id = $1`, [t]), /permission denied/);
      const read = await c.query('select count(*)::int as n from public.talks where id = $1', [t]);
      expect(read.rows[0].n).toBe(1);
      await actAs(c, null);
      await refused(c, () => c.query('select * from public.talks'), /permission denied/);
      await refused(
        c,
        () => c.query('select public.create_talk($1, $2::time, $3::time, $4, $5)', [w.lecture, '11:00', '12:00', w.l1, 'Anon']),
        /permission denied/,
      );
    });
  });

  it('sessions take an optional room; a blank room is refused', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.query(`update public.sessions set room = 'Hall A' where id = $1`, [w.lecture]);
      const { rows } = await c.query('select room from public.sessions where id = $1', [w.lecture]);
      expect(rows[0].room).toBe('Hall A');
      await refused(c, () => c.query(`update public.sessions set room = '   ' where id = $1`, [w.lecture]), /sessions_room_check/);
    });
  });
});

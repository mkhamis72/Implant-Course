import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asPostgres } from './helpers';
import { makeCourse, setPerms } from './fixtures';

const users = inject('testUsers');

describe('course_options', () => {
  it('lists courses for a user with Patients view but no Courses view, newest first', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const older = await makeCourse(c, '2030-01-01', '2030-01-05');
      const newer = await makeCourse(c, '2030-06-01', '2030-06-05');
      await setPerms(c, users.target, { patients: 'view' });
      await actAs(c, users.target);
      await c.query('savepoint s');
      expect((await c.query('select id from public.courses')).rows).toEqual([]);
      await c.query('rollback to savepoint s');
      const rows = (await c.query('select * from public.course_options()')).rows;
      const mine = rows.filter((r) => [older, newer].includes(r.id)).map((r) => r.id);
      expect(mine).toEqual([newer, older]);
      expect(Object.keys(rows[0]).sort()).toEqual(['end_date', 'id', 'name', 'start_date']);
    });
  });

  it('is refused without Patients view and for a delegate login', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      await setPerms(c, users.target, { courses: 'edit', schedule: 'edit' });
      await actAs(c, users.target);
      await c.query('savepoint s');
      await expect(c.query('select * from public.course_options()')).rejects.toThrow(/permission to view Patients/);
      await c.query('rollback to savepoint s');
      await actAs(c, users.delegate);
      await expect(c.query('select * from public.course_options()')).rejects.toThrow();
    });
  });
});

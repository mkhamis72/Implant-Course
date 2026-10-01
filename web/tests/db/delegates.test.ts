import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs } from './helpers';
import { makeDelegate } from './fixtures';

const users = inject('testUsers');

describe('delegates', () => {
  it('active organizers add and edit delegates', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await makeDelegate(c, 'Dr Karim Adel');
      await c.query("update public.delegates set licence_no = 'EG-123', active = false where id = $1", [id]);
      const { rows } = await c.query('select licence_no, active, created_by from public.delegates where id = $1', [id]);
      expect(rows[0]).toEqual({ licence_no: 'EG-123', active: false, created_by: users.organizer });
    });
  });

  it('inactive users see none and cannot add', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await makeDelegate(c);
      await actAs(c, users.inactive);
      expect((await c.query('select id from public.delegates')).rows).toHaveLength(0);
      await expect(makeDelegate(c)).rejects.toThrow(/row-level security/);
    });
  });

  it('delegates cannot be deleted, and creator/timestamps cannot be forged', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await makeDelegate(c);
      await c.query('savepoint s');
      await expect(c.query('delete from public.delegates where id = $1', [id])).rejects.toThrow(/permission denied/);
      await c.query('rollback to savepoint s');
      await expect(
        c.query("insert into public.delegates (full_name, created_by) values ('X Y', $1)", [users.admin]),
      ).rejects.toThrow(/permission denied/);
    });
  });
});

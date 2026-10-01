import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs } from './helpers';

describe('db harness', () => {
  it('impersonates a user via auth.uid()', async () => {
    const users = inject('testUsers');
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const { rows } = await c.query('select auth.uid() as uid');
      expect(rows[0].uid).toBe(users.organizer);
    });
  });
});

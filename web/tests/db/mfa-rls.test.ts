import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';

const users = inject('testUsers');

async function addVerifiedFactor(c: Client, userId: string) {
  await asPostgres(c);
  await c.query(
    `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
     values (gen_random_uuid(), $1, 'test', 'totp', 'verified', now(), now(), 'x')`,
    [userId],
  );
}

describe('RLS requires aal2 once a user has 2FA', () => {
  it('a 2FA user with a password-only (aal1) token reads nothing', async () => {
    await withTx(async (c) => {
      await addVerifiedFactor(c, users.organizer);
      await actAs(c, users.organizer, { aal: 'aal1' });
      expect((await c.query('select 1 from public.settings')).rows).toHaveLength(0);
      expect((await c.query('select user_id from public.profiles')).rows).toEqual([{ user_id: users.organizer }]);
    });
  });

  it('a 2FA admin with an aal1 token cannot change names', async () => {
    await withTx(async (c) => {
      await addVerifiedFactor(c, users.admin);
      await actAs(c, users.admin, { aal: 'aal1' });
      const r = await c.query("update public.profiles set full_name = full_name where user_id = $1", [users.target]);
      expect(r.rowCount).toBe(0);
    });
  });

  it('the same users with an aal2 token have normal access', async () => {
    await withTx(async (c) => {
      await addVerifiedFactor(c, users.admin);
      await actAs(c, users.admin, { aal: 'aal2' });
      expect((await c.query('select 1 from public.settings')).rows).toHaveLength(1);
      const r = await c.query("update public.profiles set full_name = full_name where user_id = $1", [users.target]);
      expect(r.rowCount).toBe(1);
    });
  });

  it('users without 2FA are unaffected by an aal1 token', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer, { aal: 'aal1' });
      expect((await c.query('select 1 from public.settings')).rows).toHaveLength(1);
    });
  });
});

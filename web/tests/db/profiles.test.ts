import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asPostgres } from './helpers';
import { adminClient } from '../../scripts/users';

const users = inject('testUsers');

describe('profiles & settings', () => {
  it('new auth user gets an inactive organizer profile', async () => {
    const admin = adminClient();
    const email = `icm-new-${Date.now()}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: 'Xx-123456789!', email_confirm: true });
    expect(error).toBeNull();
    try {
      await withTx(async (c) => {
        const { rows } = await c.query('select role, active, email from public.profiles where user_id = $1', [data.user!.id]);
        expect(rows).toEqual([{ role: 'organizer', active: false, email }]);
      });
    } finally {
      await admin.auth.admin.deleteUser(data.user!.id);
    }
  });

  it('active organizer can read profiles and settings', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const profiles = await c.query('select user_id from public.profiles');
      expect(profiles.rows.map((r) => r.user_id)).toEqual(expect.arrayContaining([users.admin, users.organizer]));
      const settings = await c.query('select expiry_alert_days, session_timeout_minutes from public.settings');
      expect(settings.rows).toHaveLength(1);
    });
  });

  it('inactive user sees only own profile and no settings', async () => {
    await withTx(async (c) => {
      await actAs(c, users.inactive);
      const profiles = await c.query('select user_id from public.profiles');
      expect(profiles.rows).toEqual([{ user_id: users.inactive }]);
      const settings = await c.query('select * from public.settings');
      expect(settings.rows).toHaveLength(0);
    });
  });

  it('anon has no access', async () => {
    await withTx(async (c) => {
      await actAs(c, null);
      await expect(c.query('select * from public.profiles')).rejects.toThrow(/permission denied/);
    });
  });

  it('organizer cannot change settings or roles', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const s = await c.query('update public.settings set expiry_alert_days = 10');
      expect(s.rowCount).toBe(0);
      const p = await c.query("update public.profiles set role = 'admin' where user_id = $1", [users.organizer]);
      expect(p.rowCount).toBe(0);
    });
  });

  it('admin can change settings and roles', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      const s = await c.query('update public.settings set expiry_alert_days = 90');
      expect(s.rowCount).toBe(1);
      const p = await c.query("update public.profiles set role = 'admin' where user_id = $1", [users.organizer]);
      expect(p.rowCount).toBe(1);
    });
  });

  it('settings values are range-checked', async () => {
    await withTx(async (c) => {
      await expect(c.query('update public.settings set session_timeout_minutes = 1')).rejects.toThrow(/check constraint/);
    });
  });

  it('last active admin cannot be deactivated or demoted', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      await c.query("update public.profiles set active = false where role = 'admin' and user_id <> $1", [users.admin]);
      await c.query('savepoint s');
      await expect(c.query('update public.profiles set active = false where user_id = $1', [users.admin]))
        .rejects.toThrow(/last active admin/);
      await c.query('rollback to savepoint s');
      await expect(c.query("update public.profiles set role = 'organizer' where user_id = $1", [users.admin]))
        .rejects.toThrow(/last active admin/);
    });
  });

  it('updated_at is set by the database, not the caller', async () => {
    await withTx(async (c) => {
      await c.query("update public.settings set updated_at = '2000-01-01'");
      const { rows } = await c.query('select extract(year from updated_at)::int as y from public.settings');
      expect(rows[0].y).not.toBe(2000);
    });
  });
});

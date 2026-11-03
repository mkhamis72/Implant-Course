import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asPostgres } from './helpers';
import { adminClient, pendingLoginFor } from '../../scripts/users';

const users = inject('testUsers');

describe('profiles & settings', () => {
  it('a new Auth account gets its profile and the membership of its pending login', async () => {
    const admin = adminClient();
    const email = `icm-new-${Date.now()}@example.com`;
    await pendingLoginFor(email);
    const { data, error } = await admin.auth.admin.createUser({ email, password: 'Xx-123456789!', email_confirm: true });
    expect(error).toBeNull();
    try {
      await withTx(async (c) => {
        const { rows } = await c.query(
          `select p.email, m.company_id, m.role, m.active from public.profiles p
           join public.company_members m on m.user_id = p.user_id where p.user_id = $1`, [data.user!.id]);
        expect(rows).toEqual([{ email, company_id: 'a7c0de00-0000-4000-8000-000000000001', role: 'organizer', active: true }]);
      });
    } finally {
      await admin.auth.admin.deleteUser(data.user!.id);
    }
  });

  it('refuses a new Auth account without a pending login', async () => {
    const { data, error } = await adminClient().auth.admin.createUser({
      email: `icm-none-${Date.now()}@example.com`, password: 'Xx-123456789!', email_confirm: true,
    });
    expect(error).not.toBeNull();
    expect(data.user).toBeNull();
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

  it('organizer cannot change settings or names', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const s = await c.query('update public.settings set expiry_alert_days = 10');
      expect(s.rowCount).toBe(0);
      const p = await c.query("update public.profiles set full_name = 'Zz' where user_id = $1", [users.organizer]);
      expect(p.rowCount).toBe(0);
    });
  });

  it('admin can change settings and names', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      const s = await c.query('update public.settings set expiry_alert_days = 90');
      expect(s.rowCount).toBe(1);
      const p = await c.query("update public.profiles set full_name = full_name where user_id = $1", [users.organizer]);
      expect(p.rowCount).toBe(1);
    });
  });

  it('nobody writes role, active or the delegate link on profiles (0090: they are the membership\'s)', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      for (const set of ["role = 'admin'", 'active = true', 'delegate_id = null']) {
        await c.query('savepoint s');
        await expect(c.query(`update public.profiles set ${set} where user_id = $1`, [users.organizer]))
          .rejects.toThrow(/permission denied/);
        await c.query('rollback to savepoint s');
      }
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
      await c.query(
        `update public.company_members set active = false
         where company_id = 'a7c0de00-0000-4000-8000-000000000001' and role = 'admin' and user_id <> $1`, [users.admin]);
      await c.query('savepoint s');
      await expect(c.query('update public.company_members set active = false where user_id = $1', [users.admin]))
        .rejects.toThrow(/last active admin/);
      await c.query('rollback to savepoint s');
      await expect(c.query("update public.company_members set role = 'organizer' where user_id = $1", [users.admin]))
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

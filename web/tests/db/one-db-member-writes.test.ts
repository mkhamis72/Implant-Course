import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asPostgres } from './helpers';
import { setPerms } from './fixtures';

const users = inject('testUsers');
const ACADEMY_ID = 'a7c0de00-0000-4000-8000-000000000001';
const S_ADMIN = '0e5e5530-0000-4000-8000-000000000001';
const S_VIEWER_A = '0e5e5530-0000-4000-8000-000000000002';
const S_VIEWER_B = '0e5e5530-0000-4000-8000-000000000003';
const S_OTHER = '0e5e5530-0000-4000-8000-000000000004';
const LAST_ADMIN = /Cannot remove the last active admin/;

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

/** Company B (as postgres), with the viewer as a member in the given role. */
async function companyB(c: Client, viewerRole = 'organizer'): Promise<string> {
  await asPostgres(c);
  const b = (await c.query(`insert into public.companies (slug, name) values ('zz-member-writes', 'Zz B') returning id`)).rows[0].id;
  await c.query(`insert into public.company_members (company_id, user_id, role, active) values ($1, $2, $3, true)`,
    [b, users.viewer, viewerRole]);
  return b;
}

/** Acts as the user, with the session bound to the company. */
async function bound(c: Client, user: string, session: string, company = ACADEMY_ID) {
  await actAs(c, user, { session_id: session });
  await c.query('select public.bind_my_session($1)', [company]);
}

async function member(c: Client, company: string, user: string) {
  await asPostgres(c);
  return (await c.query(
    'select role, active, mfa_setup_required from public.company_members where company_id = $1 and user_id = $2',
    [company, user])).rows[0];
}

async function profile(c: Client, user: string) {
  await asPostgres(c);
  return (await c.query('select role, active, mfa_setup_required from public.profiles where user_id = $1', [user])).rows[0];
}

/** A fresh active organizer login (academy, through the auth trigger and the forward sync). */
async function newUser(c: Client, email: string): Promise<string> {
  await asPostgres(c);
  const id = (await c.query('insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id', [email])).rows[0].id;
  await c.query(`update public.profiles set full_name = 'Zz Member Writes', active = true where user_id = $1`, [id]);
  return id;
}

describe('set_member_role / set_member_active (0087)', () => {
  it("changes only the caller's company row, and mirrors academy's to profiles", async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      await bound(c, users.admin, S_ADMIN);
      await c.query(`select public.set_member_role($1, 'admin')`, [users.viewer]);
      expect((await member(c, ACADEMY_ID, users.viewer)).role).toBe('admin');
      expect((await member(c, b, users.viewer)).role).toBe('organizer');
      expect((await profile(c, users.viewer)).role).toBe('admin');

      await bound(c, users.admin, S_ADMIN);
      await c.query('select public.set_member_active($1, false)', [users.viewer]);
      expect((await member(c, ACADEMY_ID, users.viewer)).active).toBe(false);
      expect((await member(c, b, users.viewer)).active).toBe(true);
      expect((await profile(c, users.viewer)).active).toBe(false);
    });
  });

  it('refuses a user with no membership in the company, a non-admin, and an unbound session', async () => {
    await withTx(async (c) => {
      await companyB(c);
      await c.query('delete from public.company_members where company_id = $1 and user_id = $2', [ACADEMY_ID, users.viewer]);
      await bound(c, users.admin, S_ADMIN);
      await refused(c, () => c.query(`select public.set_member_role($1, 'admin')`, [users.viewer]), /User not found\./);
      await refused(c, () => c.query('select public.set_member_active($1, true)', [users.viewer]), /User not found\./);

      await bound(c, users.organizer, S_OTHER);
      await refused(c, () => c.query(`select public.set_member_role($1, 'admin')`, [users.target]), /Only admins can do this\./);
      await refused(c, () => c.query('select public.set_member_active($1, false)', [users.target]), /Only admins can do this\./);

      await actAs(c, users.admin); // no session binding
      await refused(c, () => c.query(`select public.set_member_role($1, 'admin')`, [users.target]), /Sign in again/);
      await refused(c, () => c.query('select public.set_member_active($1, false)', [users.target]), /Sign in again/);
    });
  });

  it("refuses to leave the company without an active admin, even when another company has one", async () => {
    await withTx(async (c) => {
      await companyB(c, 'admin');
      await c.query(
        `update public.company_members set active = false
         where company_id = $1 and role = 'admin' and active and user_id <> $2`, [ACADEMY_ID, users.admin]);
      await bound(c, users.admin, S_ADMIN);
      await refused(c, () => c.query(`select public.set_member_role($1, 'organizer')`, [users.admin]), LAST_ADMIN);
      await refused(c, () => c.query('select public.set_member_active($1, false)', [users.admin]), LAST_ADMIN);
      await asPostgres(c);
      await refused(c, () => c.query('delete from public.company_members where company_id = $1 and user_id = $2',
        [ACADEMY_ID, users.admin]), LAST_ADMIN);
    });
  });
});

describe('admin_require_mfa_setup / admin_end_sessions (0087)', () => {
  it("sets the 2FA flag on the caller's company only, mirrored to profiles", async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      await bound(c, users.admin, S_ADMIN);
      await c.query('select public.admin_require_mfa_setup($1)', [users.viewer]);
      expect((await member(c, ACADEMY_ID, users.viewer)).mfa_setup_required).toBe(true);
      expect((await member(c, b, users.viewer)).mfa_setup_required).toBe(false);
      expect((await profile(c, users.viewer)).mfa_setup_required).toBe(true);
      const { rows } = await c.query(
        `select company_id from public.admin_events where user_id = $1 and kind = 'mfa_reset'`, [users.viewer]);
      expect(rows).toEqual([{ company_id: ACADEMY_ID }]);
    });
  });

  it("ends only the sessions bound to the caller's company", async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      for (const s of [S_VIEWER_A, S_VIEWER_B]) {
        await c.query('insert into auth.sessions (id, user_id, created_at, updated_at) values ($1, $2, now(), now())', [s, users.viewer]);
      }
      await c.query('insert into app.session_companies (session_id, company_id, user_id) values ($1, $2, $3), ($4, $5, $3)',
        [S_VIEWER_A, ACADEMY_ID, users.viewer, S_VIEWER_B, b]);
      await bound(c, users.admin, S_ADMIN);
      await c.query('select public.admin_end_sessions($1)', [users.viewer]);
      await asPostgres(c);
      const { rows } = await c.query('select id from auth.sessions where id = any($1)', [[S_VIEWER_A, S_VIEWER_B]]);
      expect(rows.map((r) => r.id)).toEqual([S_VIEWER_B]);
    });
  });
});

// Release-3 compatibility: the previous app version never binds, so an unbound session is academy's.
describe('unbound academy admin: the previous app version (0087)', () => {
  it('admin_require_mfa_setup works against academy', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      await c.query('select public.admin_require_mfa_setup($1)', [users.viewer]);
      expect((await member(c, ACADEMY_ID, users.viewer)).mfa_setup_required).toBe(true);
      expect((await profile(c, users.viewer)).mfa_setup_required).toBe(true);
    });
  });

  it("admin_end_sessions ends the user's unbound and academy-bound sessions, not B's", async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      for (const s of [S_VIEWER_A, S_VIEWER_B, S_OTHER]) {
        await c.query('insert into auth.sessions (id, user_id, created_at, updated_at) values ($1, $2, now(), now())', [s, users.viewer]);
      }
      await c.query('insert into app.session_companies (session_id, company_id, user_id) values ($1, $2, $3), ($4, $5, $3)',
        [S_VIEWER_A, ACADEMY_ID, users.viewer, S_VIEWER_B, b]); // S_OTHER stays unbound
      await actAs(c, users.admin);
      await c.query('select public.admin_end_sessions($1)', [users.viewer]);
      await asPostgres(c);
      const { rows } = await c.query('select id from auth.sessions where id = any($1)', [[S_VIEWER_A, S_VIEWER_B, S_OTHER]]);
      expect(rows.map((r) => r.id)).toEqual([S_VIEWER_B]);
    });
  });

  it('delete_user removes an academy user', async () => {
    await withTx(async (c) => {
      const id = await newUser(c, 'zz-member-writes-unbound@example.com');
      await actAs(c, users.admin);
      await c.query('select public.delete_user($1)', [id]);
      await asPostgres(c);
      expect((await c.query('select count(*)::int as n from public.profiles where user_id = $1', [id])).rows[0].n).toBe(0);
    });
  });
});

describe('cross-company: an academy admin who is only an organizer in B (0087)', () => {
  it('is refused, bound to B, by every member write on a B user', async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      await c.query(`insert into public.company_members (company_id, user_id, role, active) values ($1, $2, 'organizer', true)`,
        [b, users.admin]);
      await bound(c, users.admin, S_ADMIN, b);
      await refused(c, () => c.query(`select public.set_member_role($1, 'admin')`, [users.viewer]), /Only admins can do this\./);
      await refused(c, () => c.query('select public.set_member_active($1, false)', [users.viewer]), /Only admins can do this\./);
      await refused(c, () => c.query('select public.delete_user($1)', [users.viewer]), /Only an admin can remove users\./);
      await refused(c, () => c.query('select public.admin_end_sessions($1)', [users.viewer]), /Only an admin can do this\./);
      await refused(c, () => c.query('select public.admin_require_mfa_setup($1)', [users.viewer]), /Only an admin can do this\./);
      expect((await member(c, b, users.viewer)).role).toBe('organizer');
    });
  });
});

describe('delete_user (0087)', () => {
  it('removes the membership and its permissions, and keeps the profile while another membership remains', async () => {
    await withTx(async (c) => {
      const id = await newUser(c, 'zz-member-writes-shared@example.com');
      const b = (await c.query(`insert into public.companies (slug, name) values ('zz-member-writes', 'Zz B') returning id`)).rows[0].id;
      await c.query(`insert into public.company_members (company_id, user_id, role, active) values ($1, $2, 'organizer', true)`, [b, id]);
      await setPerms(c, id, { inventory: 'edit' }); // academy's
      await c.query(`insert into public.user_permissions (company_id, user_id, area, level) values ($1, $2, 'patients', 'view')`, [b, id]);
      await bound(c, users.admin, S_ADMIN);
      await c.query('select public.delete_user($1)', [id]);
      expect(await member(c, ACADEMY_ID, id)).toBeUndefined();
      expect((await member(c, b, id)).active).toBe(true);
      expect((await profile(c, id)).active).toBe(false);
      const perms = (await c.query('select company_id, area from public.user_permissions where user_id = $1', [id])).rows;
      expect(perms).toEqual([{ company_id: b, area: 'patients' }]);

      // Later profile writes (a name change, a direct write) must not make them an academy member again.
      await bound(c, users.admin, S_ADMIN);
      await c.query(`select public.admin_set_name($1, 'Zz Member Writes Renamed')`, [id]);
      expect(await member(c, ACADEMY_ID, id)).toBeUndefined();
      await c.query('update public.profiles set mfa_setup_required = true where user_id = $1', [id]);
      expect(await member(c, ACADEMY_ID, id)).toBeUndefined();
    });
  });

  it('removes the profile with the last membership', async () => {
    await withTx(async (c) => {
      const id = await newUser(c, 'zz-member-writes-only@example.com');
      await bound(c, users.admin, S_ADMIN);
      await c.query('select public.delete_user($1)', [id]);
      await asPostgres(c);
      expect((await c.query('select count(*)::int as n from public.profiles where user_id = $1', [id])).rows[0].n).toBe(0);
    });
  });

  it('refuses a user who is not a member of the caller\'s company', async () => {
    await withTx(async (c) => {
      const id = await newUser(c, 'zz-member-writes-other@example.com');
      await c.query('delete from public.company_members where company_id = $1 and user_id = $2', [ACADEMY_ID, id]);
      await bound(c, users.admin, S_ADMIN);
      await refused(c, () => c.query('select public.delete_user($1)', [id]), /User not found\./);
    });
  });
});

describe('profiles <-> academy membership mirror (0085 + 0087)', () => {
  it('a direct profiles update still reaches the member row, and back, once each way', async () => {
    await withTx(async (c) => {
      const audits = async () => (await c.query(
        `select table_name, count(*)::int as n from public.audit_log
         where row_id = $1 and table_name in ('profiles', 'company_members') and at = now()
         group by table_name order by table_name`, [users.viewer])).rows;
      await asPostgres(c);
      const before = await audits();
      expect(before).toEqual([]);

      await actAs(c, users.admin); // the previous app version's direct write
      await c.query(`update public.profiles set role = 'admin' where user_id = $1`, [users.viewer]);
      expect((await member(c, ACADEMY_ID, users.viewer)).role).toBe('admin');
      expect(await audits()).toEqual([{ table_name: 'company_members', n: 1 }, { table_name: 'profiles', n: 1 }]);

      await bound(c, users.admin, S_ADMIN); // the company-aware app's write
      await c.query(`select public.set_member_role($1, 'organizer')`, [users.viewer]);
      expect((await profile(c, users.viewer)).role).toBe('organizer');
      expect(await audits()).toEqual([{ table_name: 'company_members', n: 2 }, { table_name: 'profiles', n: 2 }]);
    });
  });

  it('staff read the members of their own company', async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      await bound(c, users.organizer, S_OTHER);
      const { rows } = await c.query('select company_id, user_id from public.company_members where user_id = $1', [users.viewer]);
      expect(rows).toEqual([{ company_id: ACADEMY_ID, user_id: users.viewer }]);

      // Bound to B, the organizer sees only B's members (plus their own rows, through 0085's policy).
      await asPostgres(c);
      await c.query(`insert into public.company_members (company_id, user_id, role, active) values ($1, $2, 'organizer', true)`,
        [b, users.organizer]);
      await bound(c, users.organizer, S_ADMIN, b);
      const others = (await c.query('select distinct company_id from public.company_members where user_id <> $1',
        [users.organizer])).rows;
      expect(others).toEqual([{ company_id: b }]);
    });
  });
});

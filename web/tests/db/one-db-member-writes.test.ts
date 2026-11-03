import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asPostgres } from './helpers';
import { pendingLogin, setPerms } from './fixtures';

const users = inject('testUsers');
const ACADEMY_ID = 'a7c0de00-0000-4000-8000-000000000001';
const S_ADMIN = '0e5e5530-0000-4000-8000-000000000001';
const S_VIEWER_A = '0e5e5530-0000-4000-8000-000000000002';
const S_VIEWER_B = '0e5e5530-0000-4000-8000-000000000003';
const S_OTHER = '0e5e5530-0000-4000-8000-000000000004';
const LAST_ADMIN = /Cannot remove the last active admin/;
const NO_DELEGATES_EDIT = /You don't have permission to edit Delegates\./;

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

/** A fresh active organizer login of academy (from a pending login, 0088). */
async function newUser(c: Client, email: string): Promise<string> {
  await pendingLogin(c, email, { fullName: 'Zz Member Writes' });
  return (await c.query('insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id', [email])).rows[0].id;
}

describe('set_member_role / set_member_active (0087)', () => {
  it("changes only the caller's company row", async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      await bound(c, users.admin, S_ADMIN);
      await c.query(`select public.set_member_role($1, 'admin')`, [users.viewer]);
      expect((await member(c, ACADEMY_ID, users.viewer)).role).toBe('admin');
      expect((await member(c, b, users.viewer)).role).toBe('organizer');

      await bound(c, users.admin, S_ADMIN);
      await c.query('select public.set_member_active($1, false)', [users.viewer]);
      expect((await member(c, ACADEMY_ID, users.viewer)).active).toBe(false);
      expect((await member(c, b, users.viewer)).active).toBe(true);
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

      await actAs(c, users.admin, { session_id: crypto.randomUUID() }); // no session binding: not an admin anywhere (0089)
      await refused(c, () => c.query(`select public.set_member_role($1, 'admin')`, [users.target]), /Only admins can do this\./);
      await refused(c, () => c.query('select public.set_member_active($1, false)', [users.target]), /Only admins can do this\./);
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
  it("sets the 2FA flag on the caller's company only", async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      await bound(c, users.admin, S_ADMIN);
      await c.query('select public.admin_require_mfa_setup($1)', [users.viewer]);
      expect((await member(c, ACADEMY_ID, users.viewer)).mfa_setup_required).toBe(true);
      expect((await member(c, b, users.viewer)).mfa_setup_required).toBe(false);
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

describe('unbound admin: no company, no admin access (0090)', () => {
  it('is refused by the member writes', async () => {
    await withTx(async (c) => {
      for (const s of [S_VIEWER_A, S_OTHER]) {
        await c.query('insert into auth.sessions (id, user_id, created_at, updated_at) values ($1, $2, now(), now())', [s, users.viewer]);
      }
      await c.query('insert into app.session_companies (session_id, company_id, user_id) values ($1, $2, $3)',
        [S_VIEWER_A, ACADEMY_ID, users.viewer]); // S_OTHER stays unbound
      await actAs(c, users.admin, { session_id: crypto.randomUUID() });
      await refused(c, () => c.query('select public.admin_require_mfa_setup($1)', [users.viewer]), /Not allowed/);
      await refused(c, () => c.query('select public.admin_end_sessions($1)', [users.viewer]), /Not allowed/);
      await refused(c, () => c.query('select public.delete_user($1)', [users.viewer]), /Not allowed/);
      expect((await member(c, ACADEMY_ID, users.viewer)).mfa_setup_required).toBe(false);

      // Bound to academy, admin_end_sessions leaves the user's unbound session alone.
      await bound(c, users.admin, S_ADMIN);
      await c.query('select public.admin_end_sessions($1)', [users.viewer]);
      await asPostgres(c);
      const { rows } = await c.query('select id from auth.sessions where id = any($1)', [[S_VIEWER_A, S_OTHER]]);
      expect(rows.map((r) => r.id)).toEqual([S_OTHER]);
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
      // No Delegates permission in B either (0089: permissions are per company), so require_perm refuses first.
      await refused(c, () => c.query('select public.admin_end_sessions($1)', [users.viewer]), NO_DELEGATES_EDIT);
      await refused(c, () => c.query('select public.admin_require_mfa_setup($1)', [users.viewer]), NO_DELEGATES_EDIT);
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
      await setPerms(c, id, { patients: 'view' }, b);
      await bound(c, users.admin, S_ADMIN);
      await c.query('select public.delete_user($1)', [id]);
      expect(await member(c, ACADEMY_ID, id)).toBeUndefined();
      expect((await member(c, b, id)).active).toBe(true);
      expect((await c.query('select count(*)::int as n from public.profiles where user_id = $1', [id])).rows[0].n).toBe(1);
      const perms = (await c.query('select company_id, area from public.user_permissions where user_id = $1', [id])).rows;
      expect(perms).toEqual([{ company_id: b, area: 'patients' }]);
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

describe('company_members_staff_select (0087)', () => {
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

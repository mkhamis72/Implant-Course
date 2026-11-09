import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, actAsBound, asPostgres } from './helpers';
import { pendingLogin } from './fixtures';

const users = inject('testUsers');
const ACADEMY_ID = 'a7c0de00-0000-4000-8000-000000000001';

/** A self_auth.user row (as postgres). With an id of an existing profile, the provisioning trigger skips it. */
async function saUser(c: Client, id: string | null, email: string, realEmail = email): Promise<string> {
  await asPostgres(c);
  return (await c.query(
    `insert into self_auth."user" (id, name, email, "emailVerified", "companyId", "realEmail")
     values (coalesce($1::uuid, gen_random_uuid()), 'T', $2, true, $3, $4) returning id`,
    [id, email, ACADEMY_ID, realEmail])).rows[0].id;
}

async function saFactor(c: Client, user: string, confirmed = true) {
  await asPostgres(c);
  await c.query('insert into self_auth.totp_factor (user_id, secret_enc, confirmed) values ($1, $2, $3)', [user, 'x', confirmed]);
}

async function saSession(c: Client, user: string, expiresIn: string): Promise<string> {
  await asPostgres(c);
  return (await c.query(
    `insert into self_auth.session ("expiresAt", token, "updatedAt", "userId")
     values (now() + $2::interval, gen_random_uuid()::text, now(), $1) returning id`, [user, expiresIn])).rows[0].id;
}

async function bind(c: Client, session: string, user: string) {
  await asPostgres(c);
  await c.query('insert into app.session_companies (session_id, company_id, user_id) values ($1, $2, $3)',
    [session, ACADEMY_ID, user]);
}

const isActive = async (c: Client) => (await c.query('select public.is_active_user() as v')).rows[0].v as boolean;

describe('Migration A: Self-Auth schema and dual-source auth helpers (0101)', () => {
  it('self_auth_factor_satisfies_mfa', async () => {
    await withTx(async (c) => {
      await saUser(c, users.organizer, 'zz-org@example.com');
      await saFactor(c, users.organizer);
      await actAs(c, users.organizer, { aal: 'aal1' });
      expect(await isActive(c)).toBe(false);
      await actAs(c, users.organizer, { aal: 'aal2' });
      expect(await isActive(c)).toBe(true);
    });
  });

  it('supabase_factor_still_satisfies_mfa', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      await c.query(
        `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
         values (gen_random_uuid(), $1, 'test', 'totp', 'verified', now(), now(), 'x')`, [users.organizer]);
      await actAs(c, users.organizer, { aal: 'aal1' });
      expect(await isActive(c)).toBe(false);
      await actAs(c, users.organizer, { aal: 'aal2' });
      expect(await isActive(c)).toBe(true);
    });
  });

  it('unconfirmed_self_auth_factor_does_not_count', async () => {
    await withTx(async (c) => {
      await saUser(c, users.organizer, 'zz-org@example.com');
      await saFactor(c, users.organizer, false);
      await actAs(c, users.organizer, { aal: 'aal1' });
      expect(await isActive(c)).toBe(true);
    });
  });

  it('mfa_setup_done_accepts_a_self_auth_factor', async () => {
    await withTx(async (c) => {
      await saUser(c, users.organizer, 'zz-org@example.com');
      await saFactor(c, users.organizer);
      const session = crypto.randomUUID();
      await bind(c, session, users.organizer);
      await c.query('update public.company_members set mfa_setup_required = true where user_id = $1 and company_id = $2',
        [users.organizer, ACADEMY_ID]);
      await actAs(c, users.organizer, { aal: 'aal2', session_id: session });
      await c.query('select public.mfa_setup_done()');
      await asPostgres(c);
      const r = await c.query('select mfa_setup_required from public.company_members where user_id = $1 and company_id = $2',
        [users.organizer, ACADEMY_ID]);
      expect(r.rows[0].mfa_setup_required).toBe(false);
    });
  });

  it('bind_session_keeps_self_auth_sessions', async () => {
    await withTx(async (c) => {
      await saUser(c, users.admin, 'zz-adm@example.com');
      const live = await saSession(c, users.admin, '1 hour');
      const expired = await saSession(c, users.admin, '-1 hour');
      const gone = crypto.randomUUID();
      const current = crypto.randomUUID();
      for (const s of [live, expired, gone]) await bind(c, s, users.admin);
      await actAs(c, users.admin, { session_id: current });
      await c.query('select public.bind_my_session($1)', [ACADEMY_ID]);
      await asPostgres(c);
      const kept = (await c.query('select session_id from app.session_companies where user_id = $1', [users.admin]))
        .rows.map((r) => r.session_id);
      expect(kept).toContain(live);
      expect(kept).toContain(current);
      expect(kept).not.toContain(expired);
      expect(kept).not.toContain(gone);
    });
  });

  it('end_sessions_hits_both', async () => {
    await withTx(async (c) => {
      await saUser(c, users.organizer, 'zz-org@example.com');
      const sa = await saSession(c, users.organizer, '1 hour');
      const supa = crypto.randomUUID();
      await asPostgres(c);
      await c.query('insert into auth.sessions (id, user_id, created_at, updated_at) values ($1, $2, now(), now())',
        [supa, users.organizer]);
      await bind(c, sa, users.organizer);
      await bind(c, supa, users.organizer);
      await actAsBound(c, users.admin);
      await c.query('select public.admin_end_sessions($1)', [users.organizer]);
      await asPostgres(c);
      expect((await c.query('select 1 from self_auth.session where id = $1', [sa])).rowCount).toBe(0);
      expect((await c.query('select 1 from auth.sessions where id = $1', [supa])).rowCount).toBe(0);
    });
  });

  it('new_self_auth_user_provisioned_from_pending_login', async () => {
    await withTx(async (c) => {
      await pendingLogin(c, 'zz-sa-new@example.com', { fullName: 'Zz Sa New', role: 'organizer' });
      const id = await saUser(c, null, 'internal-key-1', 'Zz-Sa-New@example.com');
      const p = await c.query('select email, full_name from public.profiles where user_id = $1', [id]);
      expect(p.rows).toEqual([{ email: 'zz-sa-new@example.com', full_name: 'Zz Sa New' }]);
      const m = await c.query('select company_id, role, active from public.company_members where user_id = $1', [id]);
      expect(m.rows).toEqual([{ company_id: ACADEMY_ID, role: 'organizer', active: true }]);
      expect((await c.query(`select 1 from app_private.pending_logins where email = 'zz-sa-new@example.com'`)).rowCount).toBe(0);
    });
  });

  it('new_self_auth_user_without_pending_login_is_refused', async () => {
    await withTx(async (c) => {
      await expect(saUser(c, null, 'internal-key-2', 'zz-sa-none@example.com'))
        .rejects.toThrow(/No pending login for this address\./);
    });
  });

  it('imported_user_not_reprovisioned', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const q = async () => ({
        profile: (await c.query('select * from public.profiles where user_id = $1', [users.organizer])).rows,
        members: (await c.query('select * from public.company_members where user_id = $1 order by company_id', [users.organizer])).rows,
      });
      const before = await q();
      await pendingLogin(c, 'zz-org-pending@example.com');
      await saUser(c, users.organizer, 'zz-org@example.com', 'zz-org-pending@example.com');
      expect(await q()).toEqual(before);
      expect((await c.query(`select 1 from app_private.pending_logins where email = 'zz-org-pending@example.com'`)).rowCount).toBe(1);
    });
  });

  it('deleting_a_self_auth_user_removes_profile_and_members', async () => {
    await withTx(async (c) => {
      await pendingLogin(c, 'zz-sa-del@example.com');
      const id = await saUser(c, null, 'internal-key-3', 'zz-sa-del@example.com');
      await c.query('delete from self_auth."user" where id = $1', [id]);
      expect((await c.query('select 1 from public.profiles where user_id = $1', [id])).rowCount).toBe(0);
      expect((await c.query('select 1 from public.company_members where user_id = $1', [id])).rowCount).toBe(0);
    });
  });

  it('auth_user_foreign_keys_are_dropped', async () => {
    await withTx(async (c) => {
      const r = await c.query(`select conrelid::regclass::text as t from pg_constraint
        where contype = 'f' and confrelid = 'auth.users'::regclass and connamespace = 'public'::regnamespace`);
      expect(r.rows).toEqual([]);
    });
  });
});

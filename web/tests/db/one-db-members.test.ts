import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asPostgres } from './helpers';

const users = inject('testUsers');
const ACADEMY_ID = 'a7c0de00-0000-4000-8000-000000000001';
const SESSION = '0e5e5510-0000-4000-8000-000000000001';

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

async function member(c: Client, user: string) {
  await asPostgres(c);
  const { rows } = await c.query(
    'select company_id, role, active, delegate_id, mfa_setup_required from public.company_members where user_id = $1', [user]);
  return rows;
}

describe('company_members (0085)', () => {
  it('backfills one academy row per profile, with the same role, active, delegate and 2FA flag', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const { rows } = await c.query(`
        select
          (select count(*) from public.profiles)::int as profiles,
          (select count(*) from public.company_members)::int as members,
          (select count(*) from public.profiles p join public.company_members m
             on m.user_id = p.user_id and m.company_id = $1
             and m.role = p.role and m.active = p.active
             and m.delegate_id is not distinct from p.delegate_id
             and m.mfa_setup_required = p.mfa_setup_required)::int as matching`, [ACADEMY_ID]);
      expect(rows[0].members).toBe(rows[0].profiles);
      expect(rows[0].matching).toBe(rows[0].profiles);
      expect(rows[0].profiles).toBeGreaterThan(0);
    });
  });

  it('follows an admin changing role and active on profiles', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin);
      await c.query(`update public.profiles set role = 'admin' where user_id = $1`, [users.viewer]);
      expect(await member(c, users.viewer)).toEqual([
        { company_id: ACADEMY_ID, role: 'admin', active: true, delegate_id: null, mfa_setup_required: false }]);
      await actAs(c, users.admin);
      await c.query('update public.profiles set active = false where user_id = $1', [users.viewer]);
      expect((await member(c, users.viewer))[0].active).toBe(false);
    });
  });

  it('follows the 2FA setup flag and the delegate link', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      await c.query('update public.profiles set mfa_setup_required = true where user_id = $1', [users.organizer]);
      expect((await member(c, users.organizer))[0].mfa_setup_required).toBe(true);
      const d = (await member(c, users.delegate))[0];
      expect(d.role).toBe('delegate');
      expect(d.delegate_id).not.toBeNull();
    });
  });

  it('creates the row for a new login and removes it with delete_user', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const id = (await c.query(
        `insert into auth.users (id, email) values (gen_random_uuid(), 'zz-members-new@example.com') returning id`)).rows[0].id;
      expect(await member(c, id)).toEqual([
        { company_id: ACADEMY_ID, role: 'organizer', active: false, delegate_id: null, mfa_setup_required: false }]);
      await actAs(c, users.admin);
      await c.query('select public.delete_user($1)', [id]);
      expect(await member(c, id)).toEqual([]);
      expect((await c.query('select count(*)::int as n from public.profiles where user_id = $1', [id])).rows[0].n).toBe(0);
    });
  });

  it('removes the row when the Auth account is deleted', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const id = (await c.query(
        `insert into auth.users (id, email) values (gen_random_uuid(), 'zz-members-auth@example.com') returning id`)).rows[0].id;
      await c.query('delete from auth.users where id = $1', [id]);
      expect(await member(c, id)).toEqual([]);
    });
  });

  it('audits member rows', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      await c.query('update public.profiles set active = false where user_id = $1', [users.viewer]);
      const { rows } = await c.query(
        `select action from public.audit_log where table_name = 'company_members' and row_id = $1::text`, [users.viewer]);
      expect(rows.map((r) => r.action)).toContain('UPDATE');
    });
  });

  it('shows a user their own row and an admin every row, and takes no writes', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const own = await c.query('select user_id from public.company_members');
      expect(own.rows).toEqual([{ user_id: users.organizer }]);
      await refused(c, () => c.query(
        `insert into public.company_members (company_id, user_id, role, active) values ($1, $2, 'admin', true)`,
        [ACADEMY_ID, users.organizer]), /permission denied/);
      await actAs(c, users.admin);
      const all = await c.query('select count(*)::int as n from public.company_members');
      await asPostgres(c);
      const total = await c.query('select count(*)::int as n from public.company_members');
      expect(all.rows[0].n).toBe(total.rows[0].n);
    });
  });

  it('forces row level security on both new tables', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const { rows } = await c.query(`
        select relname, relrowsecurity, relforcerowsecurity from pg_class
        where oid in ('public.company_members'::regclass, 'app.session_companies'::regclass) order by relname`);
      expect(rows).toEqual([
        { relname: 'company_members', relrowsecurity: true, relforcerowsecurity: true },
        { relname: 'session_companies', relrowsecurity: true, relforcerowsecurity: true },
      ]);
    });
  });
});

describe('session binding (0085)', () => {
  it('binds a session to a company once, and current_company_id() follows it', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer, { session_id: SESSION });
      expect((await c.query('select app.current_company_id() as id')).rows[0].id).toBeNull();
      await c.query('select app.bind_session($1)', [ACADEMY_ID]);
      expect((await c.query('select app.current_company_id() as id')).rows[0].id).toBe(ACADEMY_ID);
      await c.query('select app.bind_session($1)', [ACADEMY_ID]);
      await asPostgres(c);
      const { rows } = await c.query('select session_id, company_id, user_id from app.session_companies where session_id = $1', [SESSION]);
      expect(rows).toEqual([{ session_id: SESSION, company_id: ACADEMY_ID, user_id: users.organizer }]);
    });
  });

  it('gives no company to another user carrying the same session id', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer, { session_id: SESSION });
      await c.query('select app.bind_session($1)', [ACADEMY_ID]);
      await actAs(c, users.admin, { session_id: SESSION });
      expect((await c.query('select app.current_company_id() as id')).rows[0].id).toBeNull();
    });
  });

  it('refuses another company, a missing session and an inactive member', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const other = (await c.query(`insert into public.companies (slug, name) values ('zz-other', 'Other') returning id`)).rows[0].id;
      await actAs(c, users.organizer, { session_id: SESSION });
      await refused(c, () => c.query('select app.bind_session($1)', [other]), /You do not have access to this company\./);
      await c.query('select app.bind_session($1)', [ACADEMY_ID]);
      await asPostgres(c);
      // Even with a membership there, a bound session never moves to another company.
      await c.query(`insert into public.company_members (company_id, user_id, role, active) values ($1, $2, 'organizer', true)`,
        [other, users.organizer]);
      await actAs(c, users.organizer, { session_id: SESSION });
      await refused(c, () => c.query('select app.bind_session($1)', [other]), /You do not have access to this company\./);

      await actAs(c, users.organizer);
      await refused(c, () => c.query('select app.bind_session($1)', [ACADEMY_ID]), /No sign-in session\./);

      await asPostgres(c);
      await c.query('update public.profiles set active = false where user_id = $1', [users.viewer]);
      await actAs(c, users.viewer, { session_id: '0e5e5510-0000-4000-8000-000000000002' });
      await refused(c, () => c.query('select app.bind_session($1)', [ACADEMY_ID]), /You do not have access to this company\./);
    });
  });

  it('binds a delegate login', async () => {
    await withTx(async (c) => {
      await actAs(c, users.delegate, { session_id: SESSION });
      await c.query('select app.bind_session($1)', [ACADEMY_ID]);
      expect((await c.query('select app.current_company_id() as id')).rows[0].id).toBe(ACADEMY_ID);
    });
  });

  it('keeps session_companies from API roles', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin, { session_id: SESSION });
      await refused(c, () => c.query('select * from app.session_companies'), /permission denied/);
      await refused(c, () => c.query(
        'insert into app.session_companies (session_id, company_id, user_id) values ($1, $2, $3)',
        [SESSION, ACADEMY_ID, users.admin]), /permission denied/);
    });
  });
});

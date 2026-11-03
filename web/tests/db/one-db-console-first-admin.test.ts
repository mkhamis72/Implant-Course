import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asPostgres } from './helpers';

const users = inject('testUsers');
const ACADEMY_ID = 'a7c0de00-0000-4000-8000-000000000001';

/** A company with no members yet (as postgres). */
async function companyB(c: Client): Promise<string> {
  await asPostgres(c);
  return (await c.query(`insert into public.companies (slug, name) values ('zz-first-admin', 'Zz First Admin') returning id`)).rows[0].id;
}

/** The console's call: the service role, no signed-in user and no bound session. */
async function addFirstAdmin(c: Client, company: string, email: string, name = 'Zz Owner') {
  await asPostgres(c);
  await c.query('set local role service_role');
  // A failure leaves the role to the caller's rollback to savepoint, which also undoes the set local.
  await c.query('select public.console_add_first_admin($1, $2, $3)', [company, email, name]);
  await asPostgres(c);
}

async function members(c: Client, user: string) {
  await asPostgres(c);
  return (await c.query(
    'select company_id, role, active, delegate_id from public.company_members where user_id = $1 order by company_id',
    [user])).rows;
}

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

describe('console_add_first_admin (0093)', () => {
  it('writes a pending admin login that the new Auth account turns into an active admin membership', async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      await addFirstAdmin(c, b, ' Zz-Owner@Example.com ', 'Zz Owner');
      const pending = (await c.query(
        'select company_id, role, full_name from app_private.pending_logins where email = $1', ['zz-owner@example.com'])).rows;
      expect(pending).toEqual([{ company_id: b, role: 'admin', full_name: 'Zz Owner' }]);
      const id = (await c.query(`insert into auth.users (id, email) values (gen_random_uuid(), 'zz-owner@example.com') returning id`)).rows[0].id;
      expect(await members(c, id)).toEqual([{ company_id: b, role: 'admin', active: true, delegate_id: null }]);
      expect((await c.query('select full_name from public.profiles where user_id = $1', [id])).rows[0].full_name).toBe('Zz Owner');
    });
  });

  it("makes an existing account an active admin of the company and leaves its other companies alone", async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      const before = await members(c, users.organizer);
      await c.query(`insert into public.company_members (company_id, user_id, role, active) values ($1, $2, 'organizer', false)`,
        [b, users.organizer]);
      const { rows: [{ email }] } = await c.query('select email from public.profiles where user_id = $1', [users.organizer]);
      await addFirstAdmin(c, b, email);
      const after = await members(c, users.organizer);
      expect(after.find((m) => m.company_id === b)).toEqual({ company_id: b, role: 'admin', active: true, delegate_id: null });
      expect(after.filter((m) => m.company_id !== b)).toEqual(before);
      expect((await c.query('select count(*)::int as n from app_private.pending_logins where email = $1', [email])).rows[0].n).toBe(0);
    });
  });

  it("is a no-op for the company's existing admin (the console's password reset)", async () => {
    await withTx(async (c) => {
      const before = await members(c, users.admin);
      const { rows: [{ email }] } = await c.query('select email from public.profiles where user_id = $1', [users.admin]);
      await addFirstAdmin(c, ACADEMY_ID, email);
      expect(await members(c, users.admin)).toEqual(before);
    });
  });

  it('refuses an unknown company or an empty email', async () => {
    await withTx(async (c) => {
      await refused(c, () => addFirstAdmin(c, '00000000-0000-4000-8000-00000000abcd', 'zz-owner@example.com'), /Unknown company\./);
      await refused(c, () => addFirstAdmin(c, ACADEMY_ID, '  '), /Invalid request\./);
    });
  });

  it('is for the service role only', async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      await actAs(c, users.admin);
      await refused(c, () => c.query('select public.console_add_first_admin($1, $2, $3)', [b, 'zz-owner@example.com', 'Zz']),
        /permission denied/);
      await asPostgres(c);
      const owner = (await c.query(`select pg_get_userbyid(proowner) as owner from pg_proc
        where oid = 'public.console_add_first_admin(uuid, text, text)'::regprocedure`)).rows[0].owner;
      expect(owner).toBe('postgres');
    });
  });
});

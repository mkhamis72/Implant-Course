import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asPostgres } from './helpers';
import { insertSelfAuthUser } from './fixtures';

const users = inject('testUsers');
const OWNER_EMAIL = 'zz-console-owner@example.com';

async function provision(c: Client, slug: string, name: string): Promise<string> {
  await asPostgres(c);
  await c.query('set local role service_role');
  const { rows } = await c.query('select public.provision_company($1, $2) as id', [slug, name]);
  await asPostgres(c);
  return rows[0].id;
}

async function refused(c: Client, sql: string, params: unknown[], pattern: RegExp) {
  await c.query('savepoint s');
  await expect(c.query(sql, params)).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

async function asServiceRole(c: Client) {
  await asPostgres(c);
  await c.query('set local role service_role');
}

/** A console sign-in account (Self-Auth company 'console'), listed as an active console user. */
async function consoleUser(c: Client, email = OWNER_EMAIL): Promise<string> {
  const id = await insertSelfAuthUser(c, { companyId: 'console', email });
  await c.query('insert into public.console_users (user_id, email) values ($1, $2)', [id, email]);
  return id;
}

const count = async (c: Client, sql: string, params: unknown[]) =>
  (await c.query(`select count(*)::int as n from ${sql}`, params)).rows[0].n as number;

describe('console in production (0105)', () => {
  it('accepts a console account and gives it no profile or membership', async () => {
    await withTx(async (c) => {
      const realAdmin = (await c.query('select email from public.profiles where user_id = $1', [users.admin])).rows[0].email;
      const id = await insertSelfAuthUser(c, { companyId: 'console', email: realAdmin });
      expect(await count(c, 'public.profiles where user_id = $1', [id])).toBe(0);
      expect(await count(c, 'public.company_members where user_id = $1', [id])).toBe(0);
    });
  });

  it('still refuses a company account without a pending login', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      await refused(c, `insert into self_auth."user" (name, email, "emailVerified", "companyId", "realEmail")
        values ('x', 'zz-nopending@x.tenant.invalid', true, 'a7c0de00-0000-4000-8000-000000000001', 'zz-nopending@example.com')`,
      [], /No pending login/);
    });
  });

  it('a console account reads no company data', async () => {
    await withTx(async (c) => {
      const id = await consoleUser(c);
      await actAs(c, id, { aal: 'aal2' });
      expect(await count(c, 'public.patients', [])).toBe(0);
      expect(await count(c, 'public.companies', [])).toBe(0);
      expect((await c.query('select public.is_active_user() as ok')).rows[0].ok).toBe(false);
    });
  });

  it('is_console_user needs an active row and a second factor', async () => {
    await withTx(async (c) => {
      const id = await consoleUser(c);
      const check = async () => (await c.query('select public.is_console_user() as ok')).rows[0].ok;
      await actAs(c, id, { aal: 'aal2' });
      expect(await check()).toBe(true);
      await actAs(c, id, { aal: 'aal1' });
      expect(await check()).toBe(false);
      await actAs(c, users.admin, { aal: 'aal2' });
      expect(await check()).toBe(false);
      await asPostgres(c);
      await c.query('update public.console_users set active = false where user_id = $1', [id]);
      await actAs(c, id, { aal: 'aal2' });
      expect(await check()).toBe(false);
    });
  });

  it('is_console_user_requires_a_console_account (0106): a company account listed by mistake is refused', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      await c.query('insert into public.console_users (user_id, email) values ($1, $2)', [users.admin, 'zz-listed-by-mistake@example.com']);
      await actAs(c, users.admin, { aal: 'aal2' });
      expect((await c.query('select public.is_console_user() as ok')).rows[0].ok).toBe(false);
      const id = await consoleUser(c);
      await actAs(c, id, { aal: 'aal2' });
      expect((await c.query('select public.is_console_user() as ok')).rows[0].ok).toBe(true);
    });
  });

  it('company users cannot run the console functions or read console_users', async () => {
    await withTx(async (c) => {
      await provision(c, 'zz-a', 'Zz A');
      for (const user of [users.admin, users.organizer, users.delegate]) {
        await actAs(c, user, { aal: 'aal2' });
        await refused(c, `select public.console_update_company('zz-a', 'Zz X', array['zz-x.localhost'], 'x@y.z')`, [], /permission denied/);
        await refused(c, `select public.console_set_company_status('zz-a', 'suspended', 'reason', 'x@y.z')`, [], /permission denied/);
        await refused(c, `select public.console_log_company('zz-a', 'domain_added', 'zz-x.localhost', 'x@y.z')`, [], /permission denied/);
        await refused(c, 'select * from public.console_users', [], /permission denied/);
      }
    });
  });

  it('the service role updates name and addresses and logs the actor', async () => {
    await withTx(async (c) => {
      const id = await provision(c, 'zz-a', 'Zz A');
      await asServiceRole(c);
      await c.query(`select public.console_update_company('zz-a', ' Zz A2 ', array['zz-a.localhost'], 'owner@example.com')`);
      await asPostgres(c);
      expect((await c.query('select name, hosts from public.companies where id = $1', [id])).rows[0]).toEqual({ name: 'Zz A2', hosts: ['zz-a.localhost'] });
      const last = (await c.query(`select actor, after from public.company_log where slug = 'zz-a' order by id desc limit 1`)).rows[0];
      expect(last).toMatchObject({ actor: 'owner@example.com', after: { name: 'Zz A2', hosts: ['zz-a.localhost'] } });
      await asServiceRole(c);
      await refused(c, `select public.console_update_company('zz-none', 'Zz', array[]::text[], 'o')`, [], /Unknown company zz-none/);
    });
  });

  it('console_update_company keeps control\'s name limit (2–120 characters)', async () => {
    await withTx(async (c) => {
      await provision(c, 'zz-a', 'Zz A');
      await asServiceRole(c);
      for (const name of [' x ', 'x'.repeat(121), null]) {
        await refused(c, `select public.console_update_company('zz-a', $1, array[]::text[], 'o')`, [name], /Give a name \(2–120 characters\)\./);
      }
    });
  });

  it('console_set_company_status needs a reason and a known status, and logs the reason', async () => {
    await withTx(async (c) => {
      await provision(c, 'zz-a', 'Zz A');
      await asServiceRole(c);
      await refused(c, `select public.console_set_company_status('zz-a', 'suspended', 'ab', 'o')`, [], /Give a reason/);
      await refused(c, `select public.console_set_company_status('zz-a', 'paused', 'a reason', 'o')`, [], /Unknown status paused/);
      await refused(c, `select public.console_set_company_status('zz-none', 'suspended', 'a reason', 'o')`, [], /Unknown company zz-none/);
      await c.query(`select public.console_set_company_status('zz-a', 'suspended', ' unpaid ', 'owner@example.com')`);
      await asPostgres(c);
      expect((await c.query(`select status from public.companies where slug = 'zz-a'`)).rows[0].status).toBe('suspended');
      expect((await c.query(`select actor, reason from public.company_log where slug = 'zz-a' order by id desc limit 1`)).rows[0])
        .toEqual({ actor: 'owner@example.com', reason: 'unpaid' });
    });
  });

  it('console_log_company accepts only its four actions', async () => {
    await withTx(async (c) => {
      await provision(c, 'zz-a', 'Zz A');
      await asServiceRole(c);
      await c.query(`select public.console_log_company('zz-a', 'first_admin_invited', 'admin@example.com', 'owner@example.com')`);
      await refused(c, `select public.console_log_company('zz-a', 'x', null, 'o')`, [], /Unknown action x/);
      await refused(c, `select public.console_log_company('zz-none', 'domain_added', 'h', 'o')`, [], /Unknown company zz-none/);
      await asPostgres(c);
      expect((await c.query(`select action, actor, reason from public.company_log where slug = 'zz-a' order by id desc limit 1`)).rows[0])
        .toEqual({ action: 'first_admin_invited', actor: 'owner@example.com', reason: 'admin@example.com' });
    });
  });
});

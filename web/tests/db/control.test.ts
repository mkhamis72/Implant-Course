import { describe, it, expect, inject } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { registerTenant, tenantCompanyId } from '../../scripts/tenants';
import { listTenants, tenantSecrets } from '../../scripts/tenant-env';

const CONTROL_SQL = readFileSync(path.join(process.cwd(), 'supabase', 'control', 'migrations', '0001_control_registry.sql'), 'utf8');
const CONSOLE_SQL = readFileSync(path.join(process.cwd(), 'supabase', 'control', 'migrations', '0002_console.sql'), 'utf8');
const LOG_SQL = readFileSync(path.join(process.cwd(), 'supabase', 'control', 'migrations', '0003_console_log.sql'), 'utf8');
const COMPANY_SQL = readFileSync(path.join(process.cwd(), 'supabase', 'control', 'migrations', '0004_tenant_company.sql'), 'utf8');
const PROVISION_SQL = readFileSync(path.join(process.cwd(), 'supabase', 'control', 'migrations', '0005_provision.sql'), 'utf8');
const users = inject('testUsers');

/** The control schema applied inside the test's own (rolled-back) transaction on the dev database. */
async function withControl(fn: (c: Client) => Promise<void>) {
  await withTx(async (c) => {
    await c.query(CONTROL_SQL);
    await c.query(CONSOLE_SQL);
    await c.query(LOG_SQL);
    await fn(c);
  });
}

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

const academy = {
  slug: 'zz-academy', name: 'Zz Academy', hosts: ['Academy.Example.com'], supabaseUrl: 'https://abcdefgh.supabase.co',
  anonKey: 'anon', serviceRoleKey: 'svc-secret', databaseUrl: 'postgres://secret',
};

describe('control registry', () => {
  it('registers a company: hosts normalised, secrets in Vault, audit row written', async () => {
    await withControl(async (c) => {
      await registerTenant(c, academy);
      const t = (await c.query(`select hosts, status from public.tenants where slug = 'zz-academy'`)).rows[0];
      expect(t).toEqual({ hosts: ['academy.example.com'], status: 'active' });
      await c.query('set local role service_role');
      expect((await c.query(`select public.tenant_secret('zz-academy', 'service_role_key') as s`)).rows[0].s).toBe('svc-secret');
      await asPostgres(c);
      expect((await c.query(`select count(*)::int as n from public.tenant_audit where slug = 'zz-academy'`)).rows[0].n).toBeGreaterThan(0);
    });
  });

  it('registering again updates the row and the secrets (no duplicates)', async () => {
    await withControl(async (c) => {
      await registerTenant(c, academy);
      await registerTenant(c, { ...academy, serviceRoleKey: 'rotated' });
      await c.query('set local role service_role');
      expect((await c.query(`select public.tenant_secret('zz-academy', 'service_role_key') as s`)).rows[0].s).toBe('rotated');
    });
  });

  it('the academy row gets the academy company id; others stay null until set', async () => {
    await withTx(async (c) => {
      await c.query(CONTROL_SQL);
      await c.query(CONSOLE_SQL);
      await c.query(LOG_SQL);
      await registerTenant(c, { ...academy, slug: 'academy', hosts: ['academy.zz.example.com'] });
      await registerTenant(c, academy);
      await c.query(COMPANY_SQL);
      const rows = (await c.query(`select slug, company_id from public.tenants where slug in ('academy','zz-academy') order by slug`)).rows;
      expect(rows).toEqual([
        { slug: 'academy', company_id: 'a7c0de00-0000-4000-8000-000000000001' },
        { slug: 'zz-academy', company_id: null },
      ]);
    });
  });

  it("reads a tenant's company id; undefined before control 0004", async () => {
    await withControl(async (c) => {
      await registerTenant(c, academy);
      expect(await tenantCompanyId(c, 'zz-academy')).toBeUndefined();
      await c.query(COMPANY_SQL);
      expect(await tenantCompanyId(c, 'zz-academy')).toBeNull();
      await c.query(PROVISION_SQL);
      await registerTenant(c, { ...academy, companyId: 'a7c0de00-0000-4000-8000-000000000001' });
      expect(await tenantCompanyId(c, 'zz-academy')).toBe('a7c0de00-0000-4000-8000-000000000001');
    });
  });

  it('a host belongs to one company only', async () => {
    await withControl(async (c) => {
      await registerTenant(c, academy);
      await refused(c, () => registerTenant(c, { ...academy, slug: 'zz-other', hosts: ['academy.example.com'] }), /already used by zz-academy/);
    });
  });

  it('anon and signed-in users can read nothing and call no secret function', async () => {
    await withControl(async (c) => {
      await registerTenant(c, academy);
      for (const who of [null, '00000000-0000-0000-0000-000000000001']) {
        await actAs(c, who);
        await refused(c, () => c.query('select * from public.tenants'), /permission denied/);
        await refused(c, () => c.query(`select public.tenant_secret('zz-academy', 'service_role_key')`), /permission denied/);
      }
    });
  });

  it('only the two known secret names can be read', async () => {
    await withControl(async (c) => {
      await c.query('set local role service_role');
      await refused(c, () => c.query(`select public.tenant_secret('zz-academy', 'anything')`), /Unknown secret/);
      await refused(c, () => c.query(`select public.tenant_secret('zz-academy', null)`), /Unknown secret/);
    });
  });

  it('service role writes are audited, but it cannot touch the audit table or truncate', async () => {
    await withControl(async (c) => {
      await c.query('set local role service_role');
      const ins = `insert into public.tenants (slug, name, hosts, supabase_url, anon_key) values ('zz-svc', 'Zz Svc', array['svc.example.com'], 'https://abcdefgh.supabase.co', 'a')`;
      await c.query(ins);
      await c.query(`update public.tenants set name = 'Zz Svc 2' where slug = 'zz-svc'`);
      expect((await c.query(`select count(*)::int as n from public.tenant_audit where slug = 'zz-svc'`)).rows[0].n).toBe(2);
      await refused(c, () => c.query('delete from public.tenant_audit'), /permission denied/);
      await refused(c, () => c.query('truncate public.tenants'), /permission denied/);
    });
  });

  it('refuses null hosts', async () => {
    await withControl(async (c) => {
      await refused(c, () => c.query(
        `insert into public.tenants (slug, name, hosts, supabase_url, anon_key) values ('zz-null', 'Zz Null', array['a.example.com', null], 'https://abcdefgh.supabase.co', 'a')`,
      ), /Invalid host/);
    });
  });
});

describe('operations: reading companies from the control project', () => {
  it('lists every company, suspended ones too, in slug order', async () => {
    await withControl(async (c) => {
      await registerTenant(c, { ...academy, slug: 'zz-b', hosts: ['b.example.com'] });
      await registerTenant(c, { ...academy, slug: 'zz-a', hosts: ['a.example.com'] });
      await c.query(`update public.tenants set status = 'suspended' where slug = 'zz-b'`);
      const mine = (await listTenants(c)).filter((t) => t.slug.startsWith('zz-'));
      expect(mine.map((t) => [t.slug, t.status])).toEqual([['zz-a', 'active'], ['zz-b', 'suspended']]);
      expect(mine[0]).toMatchObject({ supabase_url: 'https://abcdefgh.supabase.co', anon_key: 'anon' });
    });
  });

  it('reads both Vault secrets, and names a missing one', async () => {
    await withControl(async (c) => {
      await registerTenant(c, academy);
      expect(await tenantSecrets(c, 'zz-academy')).toEqual({ serviceRoleKey: 'svc-secret', databaseUrl: 'postgres://secret' });
      await asPostgres(c);
      await c.query(`delete from vault.secrets where name = 'tenant/zz-academy/database_url'`);
      await expect(tenantSecrets(c, 'zz-academy')).rejects.toThrow(
        'Company zz-academy has no database_url in Vault; register it again with tenant:register.',
      );
    });
  });
});

describe('console (0002)', () => {
  const asService = (c: Client) => c.query('set local role service_role');
  const register = (c: Client, slug: string, hosts: string[], actor = 'owner@example.com') =>
    c.query('select public.console_register_tenant($1, $2, $3, $4, $5, $6, $7, $8)', [
      slug, 'Zz Co', hosts, 'https://abcdefgh.supabase.co', 'anon', 'svc', 'postgres://db', actor,
    ]);

  it('is_console_admin needs an active row and an aal2 session', async () => {
    await withControl(async (c) => {
      await c.query('insert into public.console_admins (user_id, email) values ($1, $2)', [users.admin, 'admin@example.com']);
      const check = async (claims: Record<string, unknown>) => {
        await actAs(c, users.admin, claims);
        const r = (await c.query('select public.is_console_admin() as ok')).rows[0].ok;
        await asPostgres(c);
        return r;
      };
      expect(await check({ aal: 'aal2' })).toBe(true);
      expect(await check({ aal: 'aal1' })).toBe(false);
      await c.query('update public.console_admins set active = false where user_id = $1', [users.admin]);
      expect(await check({ aal: 'aal2' })).toBe(false);
      await actAs(c, users.organizer, { aal: 'aal2' });
      expect((await c.query('select public.is_console_admin() as ok')).rows[0].ok).toBe(false);
    });
  });

  it('console functions run for service_role only', async () => {
    await withControl(async (c) => {
      await actAs(c, users.admin, { aal: 'aal2' });
      await refused(c, () => register(c, 'zz-x', ['x.example.com']), /permission denied/);
      await actAs(c, null);
      await refused(c, () => register(c, 'zz-x', ['x.example.com']), /permission denied/);
      await refused(c, () => c.query('select * from public.console_admins'), /permission denied/);
    });
  });

  it('registers a company with its Vault secrets and records the actor', async () => {
    await withControl(async (c) => {
      await asService(c);
      await register(c, 'zz-co', ['Co.Example.com'], 'owner@example.com');
      await asPostgres(c);
      expect((await c.query(`select hosts from public.tenants where slug = 'zz-co'`)).rows[0].hosts).toEqual(['co.example.com']);
      expect((await c.query(`select public.tenant_secret('zz-co', 'database_url') as v`)).rows[0].v).toBe('postgres://db');
      const audit = (await c.query(`select actor, after from public.tenant_audit where slug = 'zz-co' order by id desc limit 1`)).rows[0];
      expect(audit.actor).toBe('owner@example.com');
      expect(JSON.stringify(audit.after)).not.toContain('svc');
    });
  });

  it('suspends with a reason, refuses an empty reason and an unknown company', async () => {
    await withControl(async (c) => {
      await asService(c);
      await register(c, 'zz-co', ['co.example.com']);
      await c.query(`select public.console_set_status('zz-co', 'suspended', ' Unpaid invoice ', 'owner@example.com')`);
      await refused(c, () => c.query(`select public.console_set_status('zz-co', 'active', '  ', 'owner@example.com')`), /Give a reason \(3–300 characters\)\./);
      await refused(c, () => c.query(`select public.console_set_status('zz-nope', 'active', 'Paid now', 'owner@example.com')`), /Unknown company zz-nope/);
      await asPostgres(c);
      const row = (await c.query(`select status from public.tenants where slug = 'zz-co'`)).rows[0];
      expect(row.status).toBe('suspended');
      const audit = (await c.query(`select reason, actor from public.tenant_audit where slug = 'zz-co' order by id desc limit 1`)).rows[0];
      expect(audit).toEqual({ reason: 'Unpaid invoice', actor: 'owner@example.com' });
    });
  });

  it('updates name and hosts, refusing a host another company uses', async () => {
    await withControl(async (c) => {
      await asService(c);
      await register(c, 'zz-a', ['a.example.com']);
      await register(c, 'zz-b', ['b.example.com']);
      await c.query(`select public.console_update_tenant('zz-a', 'Zz A Renamed', array['a2.example.com'], 'owner@example.com')`);
      await refused(c, () => c.query(`select public.console_update_tenant('zz-a', 'Zz A', array['b.example.com'], 'owner@example.com')`), /already used by zz-b/);
      await asPostgres(c);
      expect((await c.query(`select name, hosts from public.tenants where slug = 'zz-a'`)).rows[0]).toEqual({ name: 'Zz A Renamed', hosts: ['a2.example.com'] });
    });
  });

  it('replaces keys in Vault and the row; accepts local URLs for development', async () => {
    await withControl(async (c) => {
      await asService(c);
      await register(c, 'zz-co', ['co.example.com']);
      await c.query(`select public.console_replace_secrets('zz-co', 'http://127.0.0.1:54321', 'anon2', 'svc2', 'postgres://db2', 'owner@example.com')`);
      await asPostgres(c);
      expect((await c.query(`select supabase_url, anon_key from public.tenants where slug = 'zz-co'`)).rows[0]).toEqual({ supabase_url: 'http://127.0.0.1:54321', anon_key: 'anon2' });
      expect((await c.query(`select public.tenant_secret('zz-co', 'service_role_key') as v`)).rows[0].v).toBe('svc2');
      await refused(c, () => c.query(`update public.tenants set supabase_url = 'http://evil.example.com' where slug = 'zz-co'`), /tenants_supabase_url_check/);
    });
  });
});

describe('console_log (0003)', () => {
  const log = (c: Client, slug: string, action: string) =>
    c.query('select public.console_log($1, $2, $3, $4)', [slug, action, 'ann@example.com', 'owner@example.com']);

  it('records who did what to whom, for service_role only', async () => {
    await withControl(async (c) => {
      await asPostgres(c);
      await registerTenant(c, academy);
      await c.query('set local role service_role');
      await log(c, 'zz-academy', 'first_admin_created');
      await asPostgres(c);
      const row = (await c.query(`select actor, reason from public.tenant_audit where slug = 'zz-academy' and action = 'first_admin_created'`)).rows[0];
      expect(row).toEqual({ actor: 'owner@example.com', reason: 'ann@example.com' });
      await actAs(c, users.admin, { aal: 'aal2' });
      await refused(c, () => log(c, 'zz-academy', 'first_admin_created'), /permission denied/);
      await actAs(c, null);
      await refused(c, () => log(c, 'zz-academy', 'first_admin_created'), /permission denied/);
    });
  });

  it('refuses unknown actions and unknown companies', async () => {
    await withControl(async (c) => {
      await asPostgres(c);
      await registerTenant(c, academy);
      await c.query('set local role service_role');
      await refused(c, () => log(c, 'zz-academy', 'delete_everything'), /Unknown action delete_everything/);
      await refused(c, () => log(c, 'zz-nope', 'admin_password_reset'), /Unknown company zz-nope/);
    });
  });
});

describe('console_set_company (0005)', () => {
  const COMPANY = 'b0000000-0000-4000-8000-00000000000b';
  const setCompany = (c: Client, slug: string, company: string) =>
    c.query('select public.console_set_company($1, $2, $3)', [slug, company, 'owner@example.com']);

  it("saves a provisioned company's id on its tenant and records the actor, for service_role only", async () => {
    await withControl(async (c) => {
      await c.query(COMPANY_SQL);
      await c.query(PROVISION_SQL);
      await registerTenant(c, academy);
      await actAs(c, users.admin, { aal: 'aal2' });
      await refused(c, () => setCompany(c, 'zz-academy', COMPANY), /permission denied/);
      await asPostgres(c);
      await c.query('set local role service_role');
      await setCompany(c, 'zz-academy', COMPANY);
      await setCompany(c, 'zz-academy', COMPANY);
      await asPostgres(c);
      expect(await tenantCompanyId(c, 'zz-academy')).toBe(COMPANY);
      const audit = (await c.query(`select actor from public.tenant_audit where slug = 'zz-academy' order by id desc limit 1`)).rows[0];
      expect(audit.actor).toBe('owner@example.com');
    });
  });

  it('never moves a tenant to another company, and refuses an unknown one', async () => {
    await withControl(async (c) => {
      await c.query(COMPANY_SQL);
      await c.query(PROVISION_SQL);
      await registerTenant(c, { ...academy, companyId: 'a7c0de00-0000-4000-8000-000000000001' });
      await c.query('set local role service_role');
      await refused(c, () => setCompany(c, 'zz-academy', COMPANY), /already has a company/);
      await refused(c, () => setCompany(c, 'zz-nope', COMPANY), /Unknown company zz-nope/);
    });
  });

  it('a company is served by one tenant per project: a second tenant for it is refused, by the function and the index', async () => {
    await withControl(async (c) => {
      await c.query(COMPANY_SQL);
      await c.query(PROVISION_SQL);
      await registerTenant(c, academy);
      await registerTenant(c, { ...academy, slug: 'zz-other', hosts: ['other.example.com'] });
      await c.query('set local role service_role');
      await setCompany(c, 'zz-academy', COMPANY);
      await refused(c, () => setCompany(c, 'zz-other', COMPANY), new RegExp(`Company ${COMPANY} is already registered as zz-academy`));
      await asPostgres(c);
      await refused(c, () => c.query('update public.tenants set company_id = $1 where slug = $2', [COMPANY, 'zz-other']),
        /tenants_company_key/);
      // Another project may hold the same id (local stacks: every database has academy's).
      await c.query(`update public.tenants set supabase_url = 'https://otherproj.supabase.co' where slug = 'zz-other'`);
      await c.query('set local role service_role');
      await setCompany(c, 'zz-other', COMPANY);
    });
  });

  it('tenant:register writes the company through console_set_company: it never repoints a tenant', async () => {
    await withControl(async (c) => {
      await c.query(COMPANY_SQL);
      await c.query(PROVISION_SQL);
      await registerTenant(c, { ...academy, companyId: COMPANY });
      await registerTenant(c, { ...academy, companyId: COMPANY });
      await refused(c, () => registerTenant(c, { ...academy, companyId: 'a7c0de00-0000-4000-8000-000000000001' }), /already has a company/);
      expect(await tenantCompanyId(c, 'zz-academy')).toBe(COMPANY);
      const audit = (await c.query(`select actor from public.tenant_audit where slug = 'zz-academy' order by id desc limit 1`)).rows[0];
      expect(audit.actor).toBe('script');
    });
  });
});

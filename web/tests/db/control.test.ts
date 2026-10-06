import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { registerTenant } from '../../scripts/tenants';

const CONTROL_SQL = readFileSync(path.join(process.cwd(), 'supabase', 'control', 'migrations', '0001_control_registry.sql'), 'utf8');

/** The control schema applied inside the test's own (rolled-back) transaction on the dev database. */
async function withControl(fn: (c: Client) => Promise<void>) {
  await withTx(async (c) => {
    await c.query(CONTROL_SQL);
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
    });
  });
});

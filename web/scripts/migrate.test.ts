import './load-env';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate } from './migrate';
import { pgConfig } from './db';
import { isLocalHost } from './test-guard';
import { DEFINER_ALLOWLIST } from './definer-allowlist';

// Against the local stack only (DATABASE_URL on 127.0.0.1 / localhost, from .env.local or ENV_FILE);
// skipped everywhere else, including CI (no env file). Each case applies one migration from a temporary
// directory; the names are unique to this file, and afterEach removes whatever a case left behind.
const url = process.env.DATABASE_URL;
const local = !!url && isLocalHost(new URL(url).hostname);

const NAME = 'zz_migrate_owner_check';
const files: string[] = [];
let dir: string | undefined;

function migration(file: string, sql: string): string {
  dir = mkdtempSync(path.join(tmpdir(), 'migrate-test-'));
  writeFileSync(path.join(dir, file), sql);
  files.push(file);
  return dir;
}

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client(pgConfig());
  await c.connect();
  try {
    return (await c.query(sql, params)).rows as T[];
  } finally {
    await c.end();
  }
}

afterEach(async () => {
  if (!local) return;
  await query(`drop function if exists public.${NAME}()`);
  await query('delete from app_private.schema_migrations where name = any($1)', [files.splice(0)]);
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe.skipIf(!local)('migrate: definer owner check (0092)', () => {
  it('rolls back a migration that leaves a postgres-owned definer, naming it', async () => {
    const d = migration('9990_zz_postgres_definer.sql', `
      create function public.${NAME}() returns int
      language sql security definer set search_path = '' as $$ select 1 $$;`);
    await expect(migrate(d)).rejects.toThrow(
      `Migration 9990_zz_postgres_definer.sql failed: tenant_definer must own every definer outside DEFINER_ALLOWLIST and must not bypass RLS: public.${NAME} (postgres)`);
    expect(await query(`select 1 from pg_proc where proname = $1`, [NAME])).toEqual([]);
    expect(await query('select 1 from app_private.schema_migrations where name = $1', ['9990_zz_postgres_definer.sql'])).toEqual([]);
  });

  it('rolls back a migration that lets tenant_definer bypass RLS', async () => {
    const d = migration('9992_zz_bypassrls.sql', 'alter role tenant_definer bypassrls;');
    await expect(migrate(d)).rejects.toThrow(
      `Migration 9992_zz_bypassrls.sql failed: ${'tenant_definer must own every definer outside DEFINER_ALLOWLIST and must not bypass RLS: '}role tenant_definer (BYPASSRLS)`);
    expect(await query(`select rolbypassrls from pg_roles where rolname = 'tenant_definer'`)).toEqual([{ rolbypassrls: false }]);
  });

  it('applies a migration whose new definer is owned by tenant_definer', async () => {
    const d = migration('9991_zz_tenant_definer.sql', `
      create function public.${NAME}() returns int
      language sql security definer set search_path = '' as $$ select 1 $$;
      grant create on schema public to tenant_definer;
      alter function public.${NAME}() owner to tenant_definer;
      revoke create on schema public from tenant_definer;`);
    expect(await migrate(d)).toEqual(['9991_zz_tenant_definer.sql']);
    expect(await query(`select pg_get_userbyid(proowner) as owner from pg_proc where proname = $1`, [NAME]))
      .toEqual([{ owner: 'tenant_definer' }]);
  });

  it('shares its allowlist with the definer-owner guard', () => {
    expect(DEFINER_ALLOWLIST.has('app_private.audit_row')).toBe(true);
    expect(DEFINER_ALLOWLIST.has('public.can')).toBe(false);
  });
});

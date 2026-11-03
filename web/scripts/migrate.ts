import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import type { ClientConfig } from 'pg';
import { pgConfig } from './db';
import { DEFINER_ALLOWLIST } from './definer-allowlist';

/**
 * Security-definer functions in public and app_private that are neither owned by tenant_definer nor on
 * DEFINER_ALLOWLIST (one database, spec §5): a definer owned by postgres bypasses the company policies.
 * Empty when the role doesn't exist (a database before 0092, or the control project).
 */
export async function definerOwnerOffenders(client: Client): Promise<string[]> {
  const { rows } = await client.query<{ name: string; owner: string }>(`
    select n.nspname || '.' || p.proname as name, pg_get_userbyid(p.proowner) as owner from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where exists (select 1 from pg_roles where rolname = 'tenant_definer')
      and n.nspname in ('public', 'app_private') and p.prosecdef
      and pg_get_userbyid(p.proowner) <> 'tenant_definer'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    order by 1`);
  return rows.filter((r) => !DEFINER_ALLOWLIST.has(r.name)).map((r) => `${r.name} (${r.owner})`);
}

export async function migrate(
  dir = path.join(process.cwd(), 'supabase', 'migrations'),
  config: ClientConfig = pgConfig(),
): Promise<string[]> {
  const client = new Client(config);
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`
      create schema if not exists app_private;
      create table if not exists app_private.schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      );`);
    const { rows } = await client.query<{ name: string }>(
      'select name from app_private.schema_migrations',
    );
    const done = new Set(rows.map((r) => r.name));
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = readFileSync(path.join(dir, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        // Inside the migration's transaction, so a definer that skips tenant_definer never commits.
        const offenders = await definerOwnerOffenders(client);
        if (offenders.length) {
          throw new Error(`definers must be owned by tenant_definer (or be on DEFINER_ALLOWLIST): ${offenders.join(', ')}`);
        }
        await client.query('insert into app_private.schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
        applied.push(file);
      } catch (error) {
        await client.query('rollback');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
  return applied;
}

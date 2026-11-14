import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import type { ClientConfig } from 'pg';
import { pgConfig } from './db';
import { DEFINER_ALLOWLIST } from './definer-allowlist';

/**
 * Security-definer functions in public and app_private that are neither owned by tenant_definer nor on
 * DEFINER_ALLOWLIST (one database, spec §5): a definer owned by postgres bypasses the company policies.
 * Also lists the role itself when it is SUPERUSER or BYPASSRLS, which would bypass them everywhere.
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
  const role = await client.query<{ name: string }>(`
    select 'role tenant_definer (' || case when rolsuper then 'SUPERUSER' else 'BYPASSRLS' end || ')' as name
    from pg_roles where rolname = 'tenant_definer' and (rolsuper or rolbypassrls)`);
  return [
    ...role.rows.map((r) => r.name),
    ...rows.filter((r) => !DEFINER_ALLOWLIST.has(r.name)).map((r) => `${r.name} (${r.owner})`),
  ];
}

/**
 * Migration B of the Self-Auth switch-over (0103; the retired control project had 0008): it removes the Supabase Auth branches and
 * re-adds the foreign keys to self_auth."user", which ends the rollback to the old app. Held by default; the owner
 * releases it after the rollback window with SELF_AUTH_B_HOLD=0 (GitHub production variable, docs/operations.md §E).
 * Held files are skipped, not a stop: migrations numbered after them still apply while they are held. So no later
 * migration (0104+) may depend on 0103 (its dropped triggers, the self_auth keys or the
 * Self-Auth-only helpers) until the hold is off everywhere; write it to work with and without Migration B.
 */
export const SELF_AUTH_B_FILES = ['0103_self_auth_b.sql'] as const;

/** Files migrate() skips: Migration B unless SELF_AUTH_B_HOLD is exactly "0" (any other value, or none, holds it). */
export function heldMigrations(env: Record<string, string | undefined> = process.env): Set<string> {
  return env.SELF_AUTH_B_HOLD?.trim() === '0' ? new Set() : new Set(SELF_AUTH_B_FILES);
}

export async function migrate(
  dir = path.join(process.cwd(), 'supabase', 'migrations'),
  config: ClientConfig = pgConfig(),
  { held = heldMigrations(), log = console.log }: { held?: Set<string>; log?: (line: string) => void } = {},
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
      if (held.has(file)) {
        // Skipped, not recorded: a later run with the hold off applies it. Files after it still apply.
        log(`Held: ${file} (SELF_AUTH_B_HOLD is not 0)`);
        continue;
      }
      const sql = readFileSync(path.join(dir, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        // Inside the migration's transaction, so a definer that skips tenant_definer never commits.
        const offenders = await definerOwnerOffenders(client);
        if (offenders.length) {
          throw new Error(`tenant_definer must own every definer outside DEFINER_ALLOWLIST and must not bypass RLS: ${offenders.join(', ')}`);
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

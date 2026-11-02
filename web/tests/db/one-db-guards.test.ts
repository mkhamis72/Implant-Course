import { describe, it, expect } from 'vitest';
import type { Client } from 'pg';
import { withTx } from './helpers';
import { DEFINER_ALLOWLIST } from '../../scripts/definer-allowlist';

// Catalog guards for company isolation in the one shared database (plan 3, spec §2, §4–§5). Each guard
// returns its offenders; an empty list passes. They run as postgres (withTx), which can call
// app.company_tables().

/** The schemas this app owns. Schema `app` holds the session helpers and is checked separately. */
const OWN_SCHEMAS = ['public', 'app_private'];

/** Definers that anon may execute: the session helpers RLS calls, and the pre-login branding readers. */
const ANON_EXEC_ALLOWLIST = new Set([
  'app.current_user_id', 'app.current_aal', 'app.current_company_id',
  'public.branding_for', 'public.branding_logo_for',
]);

/** Unique indexes on company tables scoped by a parent row instead of company_id (index name: reason). */
const PARENT_SCOPED_UNIQUES = new Set<string>([]);

/** Permissive policies that may skip the staff guard: the caller's own profile row (spec §4). */
const PERSON_LEVEL_POLICIES = new Set(['public.profiles.profiles_self']);

const STAFF_GUARD = /\b(is_active_user|can|is_admin)\(/;
const AUTH_CALL = /auth\.uid|auth\.jwt|request\.jwt/i;
const COMPANY_CHECK = /company_id = \( SELECT app\.current_company_id\(\) AS current_company_id\)/;

type Guard = (c: Client) => Promise<string[]>;

async function list(c: Client, sql: string, params: unknown[] = []): Promise<string[]> {
  const { rows } = await c.query(sql, params);
  return rows.map((r) => r.name as string).sort();
}

/** Tables (plain and partitioned) in the app's own schemas. */
const OWN_TABLES = `
  select c.oid, n.nspname || '.' || c.relname as name from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = any($1) and c.relkind in ('r', 'p')`;

/** Security-definer functions in the given schemas, extension members skipped. */
const DEFINERS = `
  select p.oid, n.nspname || '.' || p.proname as name, pg_get_userbyid(p.proowner) as owner from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = any($1) and p.prosecdef
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`;

const GUARDS = {
  'rls-forced': (c) => list(c, `
    select t.name from (${OWN_TABLES}) t join pg_class c on c.oid = t.oid
    where not (c.relrowsecurity and c.relforcerowsecurity)`, [OWN_SCHEMAS]),

  'company-policies': async (c) => {
    const { rows } = await c.query(`
      with t as (select x as oid from app.company_tables() x),
      want as (select t.oid, cmd from t cross join unnest(array['select', 'insert', 'update', 'delete']) cmd)
      select w.oid::regclass::text as tbl, (select relname from pg_class where oid = w.oid) || '_company_' || w.cmd as pol,
             p.polpermissive as permissive, p.polroles = '{0}' as to_public, p.polcmd,
             pg_get_expr(p.polqual, p.polrelid) as qual, pg_get_expr(p.polwithcheck, p.polrelid) as chk
      from want w
      left join pg_policy p on p.polrelid = w.oid
        and p.polname = (select relname from pg_class where oid = w.oid) || '_company_' || w.cmd`);
    const cmdCode: Record<string, string> = { select: 'r', insert: 'a', update: 'w', delete: 'd' };
    const offenders: string[] = [];
    for (const r of rows) {
      const cmd = (r.pol as string).split('_company_').pop()!;
      const label = `${r.tbl}: ${r.pol}`;
      if (r.permissive === null) { offenders.push(`${label} missing`); continue; }
      const problems: string[] = [];
      if (r.permissive) problems.push('permissive');
      if (!r.to_public) problems.push('not to public');
      if (r.polcmd !== cmdCode[cmd]) problems.push(`for ${r.polcmd}`);
      if (cmd !== 'insert' && !COMPANY_CHECK.test(r.qual ?? '')) problems.push('using lacks the company check');
      if ((cmd === 'insert' || cmd === 'update') && !COMPANY_CHECK.test(r.chk ?? '')) problems.push('with check lacks the company check');
      if (problems.length) offenders.push(`${label} ${problems.join(', ')}`);
    }
    return offenders.sort();
  },

  'company-id-index': (c) => list(c, `
    select a.attrelid::regclass::text as name from pg_attribute a
    join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where a.attname = 'company_id' and not a.attisdropped and c.relkind in ('r', 'p')
      and n.nspname = any($1)
      and not exists (select 1 from pg_index i where i.indrelid = a.attrelid and i.indkey[0] = a.attnum)`,
  [[...OWN_SCHEMAS, 'app']]),

  'composite-fks': (c) => list(c, `
    select k.conrelid::regclass::text || '.' || k.conname || ' -> ' || k.confrelid::regclass::text as name
    from pg_constraint k
    where k.contype = 'f' and cardinality(k.conkey) = 1
      and k.conrelid in (select app.company_tables()) and k.confrelid in (select app.company_tables())`),

  'company-uniques': async (c) => {
    const names = await list(c, `
      select i.indexrelid::regclass::text as name from pg_index i
      join pg_attribute ca on ca.attrelid = i.indrelid and ca.attname = 'company_id'
      where i.indisunique and i.indrelid in (select app.company_tables())
        and not (ca.attnum = any(i.indkey))
        -- A primary key on a single generated id is unique on its own.
        and not (i.indisprimary and i.indnkeyatts = 1 and exists (
          select 1 from pg_attribute ia where ia.attrelid = i.indrelid and ia.attnum = i.indkey[0] and ia.attname = 'id'))`);
    return names.filter((n) => !PARENT_SCOPED_UNIQUES.has(n));
  },

  'definer-owner': async (c) => {
    const { rows } = await c.query(DEFINERS, [OWN_SCHEMAS]);
    return rows.filter((r) => r.owner !== 'tenant_definer' && !DEFINER_ALLOWLIST.has(r.name))
      .map((r) => `${r.name} (${r.owner})`).sort();
  },

  'no-auth-outside-app': async (c) => {
    const fns = await c.query(`
      select n.nspname || '.' || p.proname as name, p.prosrc as body from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = any($1)
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`, [OWN_SCHEMAS]);
    const pols = await c.query(`
      select p.polrelid::regclass::text || '.' || p.polname as name,
             coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') as body
      from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1)`, [OWN_SCHEMAS]);
    return [
      ...fns.rows.filter((r) => AUTH_CALL.test(r.body)).map((r) => `function ${r.name}`),
      ...pols.rows.filter((r) => AUTH_CALL.test(r.body)).map((r) => `policy ${r.name}`),
    ].sort();
  },

  'anon-exec': async (c) => {
    const { rows } = await c.query(`
      select d.name from (${DEFINERS}) d where has_function_privilege('anon', d.oid, 'execute')`,
    [[...OWN_SCHEMAS, 'app']]);
    return rows.map((r) => r.name as string).filter((n) => !ANON_EXEC_ALLOWLIST.has(n)).sort();
  },

  'permissive-needs-guard': async (c) => {
    // The tenant_definer policies (using (true)) are the definer mechanism, not user access: skipped here,
    // required by tenant-definer-policies.
    const { rows } = await c.query(`
      select n.nspname || '.' || c.relname || '.' || p.polname as name,
             coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') as body
      from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1) and p.polpermissive
        and not (p.polroles <@ array(select oid from pg_roles where rolname = 'tenant_definer'))`, [OWN_SCHEMAS]);
    return rows.filter((r) => !PERSON_LEVEL_POLICIES.has(r.name) && !STAFF_GUARD.test(r.body))
      .map((r) => r.name as string).sort();
  },

  'tenant-definer-policies': (c) => list(c, `
    select t.name from (${OWN_TABLES}) t
    where not exists (
      select 1 from pg_policy p join pg_roles r on r.oid = any(p.polroles)
      where p.polrelid = t.oid and p.polpermissive and p.polcmd = '*' and r.rolname = 'tenant_definer')`,
  [OWN_SCHEMAS]),
} satisfies Record<string, Guard>;

type GuardName = keyof typeof GUARDS;

/** Guards a later plan-3 task enables: each task removes the names it makes pass. Plan 3 ends with none. */
const PENDING = new Set<GuardName>([
  'rls-forced', 'company-policies', 'company-id-index', 'composite-fks', 'company-uniques',
  'definer-owner', 'anon-exec', 'permissive-needs-guard', 'tenant-definer-policies',
]);

describe('one database catalog guards', () => {
  for (const [name, guard] of Object.entries(GUARDS) as [GuardName, Guard][]) {
    (PENDING.has(name) ? it.skip : it)(name, async () => {
      const offenders = await withTx((c) => guard(c));
      expect(offenders, `${name} offenders`).toEqual([]);
    });
  }

  it('PENDING holds only guard names, and shrinks to empty as plan 3 enables them', () => {
    expect([...PENDING].filter((n) => !(n in GUARDS))).toEqual([]);
    // Lower this as each task enables its guards; plan 3 ends at 0.
    expect(PENDING.size).toBe(9);
  });
});

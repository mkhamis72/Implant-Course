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
  // The previous pre-login readers (academy only) until 0095 drops them.
  'public.branding_public', 'public.branding_logo',
]);

/** Unique indexes on company tables scoped by a parent row instead of company_id. Keys are the index's
 *  regclass text: bare in public, schema-qualified elsewhere. The parent belongs to one company, and the
 *  composite foreign keys (0091) keep the child in that company. */
const PARENT_SCOPED_UNIQUES = new Set<string>([
  'app_private.research_codes_pkey', // (entity, entity_id): entity_id is one company's row
  'checklist_items_position', // within one checklist
  'enrollments_course_id_delegate_id_key', // within one course
  'implant_followups_one_visit', // within one implant
  'implant_sites_one_active', // within one patient
  'implant_surgery_pkey', // one row per implant
  'medical_history_pkey', // one row per patient
  'patient_consents_file_id_key', // one consent per stored file
  'radiograph_bone_levels_pkey', // within one radiograph
  'restoration_sites_pkey', // within one restoration
  'site_components_one_current', // within one implant
  'slot_delegates_slot_id_delegate_id_key', // within one booking
  'slot_planned_implants_slot_id_tooth_key', // within one booking
  'studies_letter_file_id_key', // one study per stored file
  'study_courses_pkey', // within one study
  'template_items_template_id_position_key', // within one template
  'tooth_status_patient_id_tooth_key', // within one patient
]);

/** Unique indexes on company tables meant to hold across companies (same key format). */
const GLOBAL_UNIQUES = new Set<string>([
  'app_private.research_codes_code_key', // random study codes: a code never repeats in any company's export
]);

/** Global uniques that 0091 replaced with per-company ones; 0095 (release 5) drops them, then this set goes. */
const REPLACED_GLOBAL_UNIQUES = new Set<string>([
  'chairs_name_key', 'checklist_templates_one_default', 'consent_form_versions_label_key',
  'patients_file_no_key', 'patients_file_no_upper_key',
]);

/** Permissive policies that may skip the staff guard: the caller's own profile row (spec §4). */
const PERSON_LEVEL_POLICIES = new Set(['public.profiles.profiles_self']);

const STAFF_GUARD = /\b(is_active_user|can|is_admin)\(/;
const AUTH_CALL = /auth\.uid|auth\.jwt|request\.jwt/i;
const COMPANY_CHECK = /\bcompany_id = \( SELECT app\.current_company_id\(\) AS current_company_id\)/;

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

  'company-tables-have-company-id': (c) => list(c, `
    select t::text as name from app.company_tables() t
    where not exists (select 1 from pg_attribute a where a.attrelid = t and a.attname = 'company_id' and not a.attisdropped)`),

  // The reverse: a table holding company_id that app.company_tables() misses would get no company policies.
  'company-id-tables-listed': (c) => list(c, `
    select t.name from (${OWN_TABLES}) t
    where exists (select 1 from pg_attribute a where a.attrelid = t.oid and a.attname = 'company_id' and not a.attisdropped)
      and t.oid not in (select app.company_tables())`, [OWN_SCHEMAS]),

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
    return names.filter((n) => !PARENT_SCOPED_UNIQUES.has(n) && !GLOBAL_UNIQUES.has(n) && !REPLACED_GLOBAL_UNIQUES.has(n));
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
    const defaults = await c.query(`
      select d.adrelid::regclass::text || '.' || a.attname as name, pg_get_expr(d.adbin, d.adrelid) as body
      from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
      join pg_class c on c.oid = d.adrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1)`, [OWN_SCHEMAS]);
    return [
      ...fns.rows.filter((r) => AUTH_CALL.test(r.body)).map((r) => `function ${r.name}`),
      ...pols.rows.filter((r) => AUTH_CALL.test(r.body)).map((r) => `policy ${r.name}`),
      ...defaults.rows.filter((r) => AUTH_CALL.test(r.body)).map((r) => `default ${r.name}`),
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

  // Every table but the migration ledger, which only postgres (BYPASSRLS) touches: tenant_definer has no
  // grant and no policy there (0092), so a definer can't rewrite which migrations count as applied.
  'tenant-definer-policies': (c) => list(c, `
    select t.name from (${OWN_TABLES}) t
    where t.name <> 'app_private.schema_migrations' and not exists (
      select 1 from pg_policy p join pg_roles r on r.oid = any(p.polroles)
      where p.polrelid = t.oid and p.polpermissive and p.polcmd = '*' and r.rolname = 'tenant_definer')`,
  [OWN_SCHEMAS]),

  // The console's functions (0093) take a company as an argument: only the service role may call them.
  // tenant_definer gets execute on new functions by default (0092), so each must revoke it.
  'service-role-only': (c) => list(c, `
    select p.oid::regprocedure::text as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'console\\_%'
      and (not has_function_privilege('service_role', p.oid, 'execute')
           or has_function_privilege('anon', p.oid, 'execute')
           or has_function_privilege('authenticated', p.oid, 'execute')
           or has_function_privilege('tenant_definer', p.oid, 'execute'))`),
} satisfies Record<string, Guard>;

type GuardName = keyof typeof GUARDS;

/** Guards a later plan-3 task enables: each task removes the names it makes pass. Plan 3 ends with none. */
const PENDING = new Set<GuardName>([]);

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
    expect(PENDING.size).toBe(0);
  });

  it('tenant_definer has no access to the migration ledger', async () => {
    const { rows } = await withTx((c) => c.query(`
      select has_table_privilege('tenant_definer', 'app_private.schema_migrations', 'select, insert, update, delete') as any_priv,
             (select count(*)::int from pg_policy where polrelid = 'app_private.schema_migrations'::regclass) as policies`));
    expect(rows[0]).toEqual({ any_priv: false, policies: 0 });
  });

  it('app.company_tables() lists the company tables (a guard over an empty list proves nothing)', async () => {
    const { rows } = await withTx((c) => c.query('select count(*)::int as n from app.company_tables()'));
    expect(rows[0].n).toBeGreaterThanOrEqual(40);
  });
});

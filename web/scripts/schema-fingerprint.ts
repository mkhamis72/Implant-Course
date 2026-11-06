import './load-env';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { pgConfig } from './db';
import { applyTenantArg } from './tenant-env';

/**
 * Release 4 rollback proof: the schema, grants and roles of the app schemas (public, app_private, app), with no row data.
 * One entry per schema, relation, column, function, constraint, index, policy, trigger, type, default privilege and
 * non-system role; ACLs are sorted and NULL is replaced by the built-in default, so equal privileges compare equal.
 *   schema-fingerprint [--tenant academy] --out <file>
 *   schema-fingerprint --compare <before> <after>      exit 1 on any difference
 */
export type Fingerprint = { target: string; entries: Record<string, string> };

export const FINGERPRINT_SCHEMAS = ['public', 'app_private', 'app'];

const acl = (col: string, kind: string, owner: string) =>
  `(select string_agg(a::text, ',' order by a::text) from unnest(coalesce(${col}, acldefault(${kind}, ${owner}))) a)`;

/** One query per object kind; each returns (k, v) text pairs. Run with search_path '' so names come out qualified. */
export function fingerprintQueries(schemas = FINGERPRINT_SCHEMAS): string[] {
  const ns = `(${schemas.map((s) => `'${s}'`).join(', ')})`;
  return [
    `select 'schema ' || nspname as k, concat_ws(' | ', pg_get_userbyid(nspowner), ${acl('nspacl', "'n'", 'nspowner')}) as v
       from pg_namespace where nspname in ${ns}`,
    `select 'rel ' || n.nspname || '.' || c.relname as k,
            concat_ws(' | ', c.relkind, pg_get_userbyid(c.relowner), ${acl('c.relacl', "case when c.relkind = 'S' then 's' else 'r' end::\"char\"", 'c.relowner')},
                      'rls=' || c.relrowsecurity, 'force=' || c.relforcerowsecurity,
                      case when c.relkind in ('v', 'm') then md5(pg_get_viewdef(c.oid)) end) as v
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ${ns} and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')`,
    `select 'col ' || n.nspname || '.' || c.relname || '.' || a.attname as k,
            concat_ws(' | ', format_type(a.atttypid, a.atttypmod), 'notnull=' || a.attnotnull, 'identity=' || a.attidentity::text,
                      'generated=' || a.attgenerated::text, pg_get_expr(d.adbin, d.adrelid),
                      (select string_agg(x::text, ',' order by x::text) from unnest(a.attacl) x)) as v
       from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
       left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where n.nspname in ${ns} and c.relkind in ('r', 'p', 'v', 'm', 'f') and a.attnum > 0 and not a.attisdropped`,
    `select 'fn ' || p.oid::regprocedure::text as k,
            concat_ws(' | ', p.prokind, pg_get_userbyid(p.proowner), ${acl('p.proacl', "'f'", 'p.proowner')}, 'definer=' || p.prosecdef,
                      md5(case when p.prokind = 'a' then p.prosrc else pg_get_functiondef(p.oid) end)) as v
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ${ns} and not exists (select 1 from pg_depend e where e.objid = p.oid and e.deptype = 'e')`,
    `select 'con ' || n.nspname || '.' || coalesce(c.relname, t.typname, '-') || '.' || o.conname as k, pg_get_constraintdef(o.oid) as v
       from pg_constraint o join pg_namespace n on n.oid = o.connamespace
       left join pg_class c on c.oid = o.conrelid left join pg_type t on t.oid = o.contypid
      where n.nspname in ${ns}`,
    `select 'idx ' || n.nspname || '.' || c.relname as k, pg_get_indexdef(c.oid) as v
       from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ${ns} and c.relkind in ('i', 'I')`,
    `select 'pol ' || schemaname || '.' || tablename || '.' || policyname as k,
            concat_ws(' | ', permissive, (select string_agg(r, ',' order by r) from unnest(roles) r), cmd, qual, with_check) as v
       from pg_policies where schemaname in ${ns}`,
    `select 'trg ' || c.oid::regclass::text || '.' || t.tgname as k, concat_ws(' | ', t.tgenabled, pg_get_triggerdef(t.oid)) as v
       from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
       join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
      where not t.tgisinternal and (n.nspname in ${ns} or pn.nspname in ${ns})`,
    `select 'type ' || n.nspname || '.' || t.typname as k,
            concat_ws(' | ', t.typtype, pg_get_userbyid(t.typowner), ${acl('t.typacl', "'T'", 't.typowner')},
                      (select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid),
                      case when t.typtype = 'd' then format_type(t.typbasetype, t.typtypmod) end) as v
       from pg_type t join pg_namespace n on n.oid = t.typnamespace
      where n.nspname in ${ns} and t.typtype in ('e', 'd', 'c', 'r', 'm')
        and (t.typrelid = 0 or (select relkind from pg_class where oid = t.typrelid) = 'c')`,
    `select 'defacl ' || pg_get_userbyid(d.defaclrole) || ' ' || coalesce(n.nspname, '(all schemas)') || ' ' || d.defaclobjtype::text as k,
            (select string_agg(a::text, ',' order by a::text) from unnest(d.defaclacl) a) as v
       from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
      where d.defaclnamespace = 0 or n.nspname in ${ns}`,
    `select 'role ' || rolname as k, concat_ws(' | ', 'super=' || rolsuper, 'bypassrls=' || rolbypassrls, 'login=' || rolcanlogin,
            (select string_agg(g.rolname, ',' order by g.rolname) from pg_auth_members m join pg_roles g on g.oid = m.roleid where m.member = r.oid)) as v
       from pg_roles r where rolname not like 'pg\\_%'`,
  ];
}

export type FingerprintDiff = { onlyBefore: string[]; onlyAfter: string[]; different: string[]; regrouped: string[] };

/**
 * A CHECK written `a and b and c` in a migration is stored as nested ANDs, ((a AND b) AND c); dumped and restored it
 * comes back flat, (a AND b AND c). Same rule, other parentheses: such a pair is `regrouped`, not different.
 */
const regroupedCheck = (key: string, b: string, a: string) =>
  key.startsWith('con ') && b.startsWith('CHECK ') && a.startsWith('CHECK ') && b.replace(/[()]/g, '') === a.replace(/[()]/g, '');

/** Pure: every key on one side only, and every key whose value differs (a CHECK that differs only in grouping apart). */
export function compareFingerprints(before: Fingerprint, after: Fingerprint): FingerprintDiff {
  const b = before.entries;
  const a = after.entries;
  const changed = Object.keys(b).filter((k) => k in a && a[k] !== b[k]).sort();
  return {
    onlyBefore: Object.keys(b).filter((k) => !(k in a)).sort(),
    onlyAfter: Object.keys(a).filter((k) => !(k in b)).sort(),
    different: changed.filter((k) => !regroupedCheck(k, b[k], a[k])),
    regrouped: changed.filter((k) => regroupedCheck(k, b[k], a[k])),
  };
}

export async function collectFingerprint(c: Client): Promise<Record<string, string>> {
  const entries: Record<string, string> = {};
  await c.query("set search_path = ''");
  for (const sql of fingerprintQueries()) {
    for (const r of (await c.query<{ k: string; v: string | null }>(sql)).rows) entries[r.k] = r.v ?? '';
  }
  return Object.fromEntries(Object.entries(entries).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--compare')) {
    const i = argv.indexOf('--compare');
    const [bf, af] = [argv[i + 1], argv[i + 2]];
    if (!bf || !af) throw new Error('Usage: schema-fingerprint --compare <before> <after>');
    const before: Fingerprint = JSON.parse(readFileSync(bf, 'utf8'));
    const after: Fingerprint = JSON.parse(readFileSync(af, 'utf8'));
    const d = compareFingerprints(before, after);
    for (const k of d.regrouped) console.log(`REGROUPED ${k} (same CHECK, other parentheses)`);
    for (const k of d.onlyBefore) console.log(`ONLY BEFORE ${k}`);
    for (const k of d.onlyAfter) console.log(`ONLY AFTER ${k}`);
    for (const k of d.different) console.log(`DIFFERENT ${k}\n  before: ${before.entries[k]}\n  after:  ${after.entries[k]}`);
    const n = d.onlyBefore.length + d.onlyAfter.length + d.different.length;
    console.log(`${Object.keys(before.entries).length} entries before, ${Object.keys(after.entries).length} after`);
    console.log(n ? `FAIL (${n} differences)` : 'PASS');
    process.exitCode = n ? 1 : 0;
    return;
  }
  const i = argv.indexOf('--out');
  const outArg = argv[i + 1];
  if (i === -1 || !outArg || outArg.startsWith('--')) throw new Error('Usage: schema-fingerprint [--tenant <slug>] --out <file>  |  --compare <before> <after>');
  const out = path.resolve(outArg);
  await applyTenantArg([...argv.slice(0, i), ...argv.slice(i + 2)], process.env);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const host = new URL(url).hostname;
  console.log(`Target project: ${host}`);
  const c = new Client(pgConfig(process.env));
  await c.connect();
  try {
    await c.query('begin read only');
    const entries = await collectFingerprint(c);
    await c.query('rollback');
    writeFileSync(out, JSON.stringify({ target: host, entries } satisfies Fingerprint, null, 1));
    console.log(`${Object.keys(entries).length} entries -> ${out}`);
  } finally {
    await c.end();
  }
}

if (process.argv[1] && /schema-fingerprint\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

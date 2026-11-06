import './load-env';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import { pgConfig } from './db';
import { isLocalHost } from './test-guard';
import { applyTenantArg } from './tenant-env';
import { redact } from './pre-one-db-backup-lib';

/**
 * Release 4 rollback: puts a company's database back to the pre-window dump (release 3: migrations through 0088).
 *   ENV_FILE=.env.prod npm run window:rollback -- --tenant academy --dump <pre-window>/academy/full.dump --confirm <project ref>
 *
 * One psql transaction (all or nothing; a failure leaves the database as it was):
 *   1. drop owned by tenant_definer (0092) and drop the role, so a later retry of 0089-0095 starts from release 3;
 *   2. drop the schemas app and app_private, and every object of ours in public (public itself stays: it carries
 *      Supabase's own default privileges);
 *   3. neutralise our default privileges in public, so restored objects start from the built-in ACLs and the dump's
 *      GRANT / REVOKE lines give exactly the release 3 ACLs (the dump's DEFAULT ACL lines then put the defaults back);
 *   4. replay the dump's public, app_private and app entries (schema, data, ACLs; the dump must be taken WITH ACLs,
 *      which backup:pre-one-db does since release 4) and the triggers outside them that call our functions
 *      (auth.users on_auth_user_created).
 * auth is not touched: the window does not change it. Proof afterwards: window:checksums --compare and
 * schema:fingerprint --compare against the files taken before the window (release-4-runbook.md, Rollback).
 */

export const ROLLBACK_SCHEMAS = ['public', 'app_private', 'app'];

// pg_dump TOC descriptions, longest first so "TABLE DATA" wins over "TABLE".
const DESCS = [
  'MATERIALIZED VIEW DATA', 'SEQUENCE OWNED BY', 'PUBLICATION TABLE', 'PUBLICATION TABLES IN SCHEMA', 'DEFAULT ACL', 'TABLE DATA',
  'FK CONSTRAINT', 'CHECK CONSTRAINT', 'SEQUENCE SET', 'EVENT TRIGGER', 'ROW SECURITY', 'INDEX ATTACH', 'MATERIALIZED VIEW',
  'FOREIGN TABLE', 'SHELL TYPE', 'LARGE OBJECT', 'USER MAPPING', 'FOREIGN DATA WRAPPER', 'TEXT SEARCH CONFIGURATION',
  'TEXT SEARCH DICTIONARY', 'TEXT SEARCH PARSER', 'TEXT SEARCH TEMPLATE', 'OPERATOR CLASS', 'OPERATOR FAMILY', 'ACL', 'AGGREGATE',
  'CAST', 'COLLATION', 'COMMENT', 'CONSTRAINT', 'CONVERSION', 'DATABASE', 'DEFAULT', 'DOMAIN', 'ENCODING', 'EXTENSION',
  'FUNCTION', 'INDEX', 'OPERATOR', 'POLICY', 'PROCEDURE', 'PUBLICATION', 'RULE', 'SCHEMA', 'SEQUENCE', 'SERVER', 'STATISTICS',
  'STDSTRINGS', 'SEARCHPATH', 'SUBSCRIPTION', 'TABLE', 'TRANSFORM', 'TRIGGER', 'TYPE', 'VIEW', 'BLOBS', 'BLOB',
].sort((a, b) => b.length - a.length);

export type TocEntry = { line: string; desc: string; namespace: string; rest: string };

/** One `pg_restore -l` line: `<id>; <catalog oid> <oid> <desc> <namespace> <tag ...> <owner>`. Comments and blanks: null. */
export function parseTocLine(line: string): TocEntry | null {
  const m = line.match(/^\d+;\s+\d+\s+\d+\s+(.*)$/);
  if (!m) return null;
  const desc = DESCS.find((d) => m[1].startsWith(`${d} `));
  if (!desc) return null;
  const [namespace, ...rest] = m[1].slice(desc.length + 1).split(' ');
  return { line, desc, namespace, rest: rest.join(' ') };
}

/**
 * The entries the rollback replays, in the dump's order: everything in `schemas` except the default privileges of
 * other roles (only `owner` can set its own); the SCHEMA, its ACL and COMMENT for each schema but public (kept, not
 * dropped); and the listed outside triggers (`auth users on_auth_user_created`).
 */
export function rollbackList(toc: string, opts: { schemas?: string[]; owner: string; triggers: string[] }): string[] {
  const schemas = opts.schemas ?? ROLLBACK_SCHEMAS;
  const recreated = schemas.filter((s) => s !== 'public');
  const out: string[] = [];
  for (const raw of toc.split(/\r?\n/)) {
    const e = parseTocLine(raw);
    if (!e) continue;
    const owner = e.rest.split(' ').at(-1);
    if (schemas.includes(e.namespace)) {
      if (e.desc === 'DEFAULT ACL' && owner !== opts.owner) continue;
      out.push(e.line);
    } else if (e.namespace === '-' && ['SCHEMA', 'ACL', 'COMMENT'].includes(e.desc)) {
      const target = e.desc === 'SCHEMA' ? e.rest.split(' ')[0] : e.rest.startsWith('SCHEMA ') ? e.rest.split(' ')[1] : null;
      if (target && recreated.includes(target)) out.push(e.line);
    } else if (e.desc === 'TRIGGER' && opts.triggers.includes(`${e.namespace} ${e.rest.split(' ').slice(0, 2).join(' ')}`)) {
      out.push(e.line);
    }
  }
  return out;
}

/** Steps 1 to 3, run before the dump's entries in the same transaction. */
export function preludeSql(): string {
  return `\\set ON_ERROR_STOP on
set lock_timeout = '10s';
do $$ begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'tenant_definer') then
    execute 'drop owned by tenant_definer cascade';
    execute 'drop role tenant_definer';
  end if;
end $$;
drop schema if exists app cascade;
drop schema if exists app_private cascade;
do $$
declare r record;
begin
  -- Every object of ours left in public, captured first (a cascade may already have dropped a later one).
  for r in
    select format('drop %s if exists %s cascade', case c.relkind when 'v' then 'view' when 'm' then 'materialized view'
             when 'S' then 'sequence' when 'f' then 'foreign table' else 'table' end, c.oid::regclass) as cmd, 1 as ord
      from pg_catalog.pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
       and pg_catalog.pg_has_role(c.relowner, 'USAGE')
       and not exists (select 1 from pg_catalog.pg_depend d where d.objid = c.oid and d.deptype in ('e', 'a', 'i'))
    union all
    select format('drop routine if exists %s cascade', p.oid::regprocedure), 2
      from pg_catalog.pg_proc p
     where p.pronamespace = 'public'::regnamespace and pg_catalog.pg_has_role(p.proowner, 'USAGE')
       and not exists (select 1 from pg_catalog.pg_depend d where d.objid = p.oid and d.deptype = 'e')
    union all
    select format('drop type if exists %s cascade', t.oid::regtype), 3
      from pg_catalog.pg_type t
     where t.typnamespace = 'public'::regnamespace and t.typtype in ('e', 'd', 'c', 'r', 'm') and pg_catalog.pg_has_role(t.typowner, 'USAGE')
       and (t.typrelid = 0 or (select relkind from pg_catalog.pg_class where oid = t.typrelid) = 'c')
       and not exists (select 1 from pg_catalog.pg_depend d where d.objid = t.oid and d.deptype in ('e', 'i', 'a'))
    order by 2
  loop
    execute r.cmd;
  end loop;
  -- Our default privileges in public: revoke every grantee, so new objects get the built-in ACLs.
  for r in
    select distinct d.defaclobjtype as t,
           case when a.grantee = 0 then 'public' else pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(a.grantee)) end as g
      from pg_catalog.pg_default_acl d, pg_catalog.aclexplode(d.defaclacl) a
     where d.defaclrole = current_user::regrole and d.defaclnamespace = 'public'::regnamespace
  loop
    execute format('alter default privileges for role %I in schema public revoke all on %s from %s', current_user,
      case r.t when 'r' then 'tables' when 'S' then 'sequences' when 'f' then 'functions' when 'T' then 'types' end, r.g);
  end loop;
end $$;
`;
}

/** Runs last, still in the transaction: the ledger must be back at release 3. */
export function postSql(): string {
  return `do $$ begin
  if exists (select 1 from app_private.schema_migrations where name >= '0089') then
    raise exception 'rollback check: schema_migrations still lists 0089 or later';
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'tenant_definer') then
    raise exception 'rollback check: role tenant_definer still exists';
  end if;
end $$;
select 'ledger: ' || count(*) || ' migrations, last ' || max(name) as rollback from app_private.schema_migrations;
`;
}

/** Project ref from a database URL: db.<ref>.supabase.co, or the pooler user postgres.<ref>; otherwise the host. */
export function projectRef(databaseUrl: string): string {
  const u = new URL(databaseUrl);
  return u.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1] ?? decodeURIComponent(u.username).split('.')[1] ?? u.hostname;
}

function takeArg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  const v = argv[i + 1];
  return i === -1 || !v || v.startsWith('--') ? undefined : v;
}

async function main() {
  const argv = process.argv.slice(2);
  const usage = 'Usage: npm run window:rollback -- [--tenant <slug>] --dump <pre-window>/<company>/full.dump --confirm <project ref>';
  const dumpArg = takeArg(argv, '--dump');
  const confirm = takeArg(argv, '--confirm');
  if (!dumpArg || !confirm) throw new Error(usage);
  const dump = path.resolve(dumpArg);
  await applyTenantArg(argv.filter((a, i) => !['--dump', '--confirm'].includes(a) && !['--dump', '--confirm'].includes(argv[i - 1])), process.env);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const host = new URL(url).hostname;
  const ref = projectRef(url);
  console.log(`Target project: ${host} (ref ${ref})`);
  if (confirm !== ref) throw new Error(`Refusing: --confirm ${confirm} does not match the target's ref ${ref}`);
  const local = isLocalHost(host);

  // Triggers outside our schemas that call our functions are dropped by the cascade; the dump must recreate each.
  const c = new Client(pgConfig(process.env));
  await c.connect();
  let triggers: string[];
  let owner: string;
  try {
    owner = (await c.query('select current_user as u')).rows[0].u;
    triggers = (await c.query(`
      select n.nspname || ' ' || c.relname || ' ' || t.tgname as t from pg_trigger t join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace join pg_proc p on p.oid = t.tgfoid
       where not t.tgisinternal and n.nspname <> all($1) and p.pronamespace::regnamespace::text = any($1)`, [ROLLBACK_SCHEMAS])).rows.map((r) => r.t);
    const others = (await c.query(`
      select pol.polname || ' on ' || pol.polrelid::regclass as o from pg_policy pol join pg_class c on c.oid = pol.polrelid
       where c.relnamespace::regnamespace::text <> all($1)
         and exists (select 1 from pg_depend d join pg_proc p on p.oid = d.refobjid where d.objid = pol.oid and p.pronamespace::regnamespace::text = any($1))
      union all
      select v.oid::regclass::text from pg_rewrite r join pg_class v on v.oid = r.ev_class
       where v.relnamespace::regnamespace::text <> all($1)
         and exists (select 1 from pg_depend d join pg_class x on x.oid = d.refobjid where d.objid = r.oid and x.relnamespace::regnamespace::text = any($1))`,
    [ROLLBACK_SCHEMAS])).rows.map((r) => r.o);
    if (others.length) throw new Error(`Refusing: objects outside ${ROLLBACK_SCHEMAS.join(', ')} depend on them and would be lost: ${others.join(', ')}`);
    const at = (await c.query("select max(name) as m from app_private.schema_migrations")).rows[0].m;
    console.log(`Now at ${at}; outside triggers to recreate: ${triggers.join(', ') || '(none)'}`);
  } finally {
    await c.end();
  }

  const secrets = [url, decodeURIComponent(new URL(url).password), new URL(url).password];
  const dockerUrl = new URL(url);
  if (local) dockerUrl.hostname = 'host.docker.internal';
  const work = mkdtempSync(path.join(tmpdir(), 'window-rollback-'));
  const mounts = ['-v', `${path.dirname(dump)}:/in:ro`, '-v', `${work}:/work:ro`];
  const tls: string[] = [];
  if (!local) {
    const ca = process.env.DATABASE_CA_CERT;
    if (!ca) throw new Error('DATABASE_CA_CERT is not set');
    tls.push('-e', 'PGSSLMODE=verify-full', '-e', 'PGSSLROOTCERT=/ca.crt');
    mounts.push('-v', `${path.resolve(ca)}:/ca.crt:ro`);
  }
  const docker = (script: string) => {
    const r = spawnSync('docker', ['run', '--rm', '-e', 'PGURL', ...tls, ...mounts, 'postgres:17', 'sh', '-c', script],
      { env: { ...process.env, PGURL: dockerUrl.toString(), MSYS_NO_PATHCONV: '1' }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.error) throw new Error(redact(`docker failed to start: ${r.error.message}`, secrets));
    const text = redact(`${r.stdout ?? ''}${r.stderr ?? ''}`, secrets).trim();
    if (r.status !== 0) throw new Error(`docker exited ${r.status}${text ? `:\n${text.split('\n').slice(-30).join('\n')}` : ''}`);
    return r.stdout ?? '';
  };

  try {
    const file = `/in/${path.basename(dump)}`;
    const list = rollbackList(docker(`pg_restore -l ${file}`), { owner, triggers });
    for (const t of triggers) {
      if (!list.some((l) => parseTocLine(l)?.desc === 'TRIGGER' && l.includes(` ${t} `))) throw new Error(`Refusing: the dump has no entry for trigger ${t}`);
    }
    if (!list.some((l) => / TABLE DATA app_private schema_migrations /.test(l))) throw new Error('Refusing: the dump has no app_private.schema_migrations data');
    if (!list.some((l) => / ACL /.test(l))) throw new Error('Refusing: the dump has no ACL entries (taken with --no-acl?); its grants could not be restored');
    writeFileSync(path.join(work, 'list'), `${list.join('\n')}\n`);
    writeFileSync(path.join(work, 'prelude.sql'), preludeSql());
    writeFileSync(path.join(work, 'post.sql'), postSql());
    console.log(`Replaying ${list.length} dump entries in one transaction ...`);
    const started = Date.now();
    // The SQL script holds the data: it stays inside the container (removed with it), never on the host.
    const out = docker(`pg_restore --no-owner -L /work/list -f /tmp/restore.sql ${file} && psql "$PGURL" --single-transaction -v ON_ERROR_STOP=1 -q -X -At -f /work/prelude.sql -f /tmp/restore.sql -f /work/post.sql`);
    for (const l of out.split('\n').filter((x) => x.startsWith('ledger: '))) console.log(l);
    console.log(`Rolled back in ${((Date.now() - started) / 1000).toFixed(1)} s. Now run window:checksums and schema:fingerprint and compare.`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && /window-rollback\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

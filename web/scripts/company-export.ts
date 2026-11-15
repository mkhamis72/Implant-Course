import './load-env';
import { writeFileSync } from 'node:fs';
import { Client } from 'pg';
import { pgConfig } from './db';
import { companyIdBySlug, takeCompanyArg, UnknownCompanyError } from './one-database';
import { targetLabel } from './create-user-args';

/*
 * Limits (company-export and company-restore): for one company in a shared database, not a whole-database
 * disaster. The company's own Self-Auth accounts and its members' profiles are exported; a former member still
 * named by this company's rows is not in the file (the restore's foreign-key check then fails on an empty
 * database). Identity sequences are not advanced by the restore (the live database's are already past the
 * restored ids). Files' bytes (bytea) travel as hex inside the JSON and the whole file is held in memory.
 * Whole-database disasters use the nightly pg_dump (docs/operations.md section D).
 */

export type Row = Record<string, unknown>;

/** One company's data: its companies row; its sign-in accounts (Self-Auth users, password and Google links,
 *  authenticators) and its members' profiles; then its rows from every company table (parents before children).
 *  Holds password hashes and encrypted authenticator secrets: keep it as private as a database dump.
 *  v1 files (before 2026-11-16) had `auth.users` instead of the self_auth tables and no `company`. */
export type CompanyExport = {
  format: 'company-export-v2';
  company_id: string;
  exported_at: string;
  company: Row;
  tables: Record<string, Row[]>;
};

type RawJson = { rawJSON(text: string): unknown };
const rawJson = (JSON as unknown as RawJson).rawJSON;
type Reviver = (key: string, value: unknown, context: { source?: string }) => unknown;

/** JSON.parse that keeps every number exactly as written (10.0, bigints, long numerics), as raw JSON values. */
export function parseExact(text: string): unknown {
  const reviver: Reviver = (_key, value, context) => (typeof value === 'number' && context.source ? rawJson(context.source) : value);
  return JSON.parse(text, reviver as Parameters<typeof JSON.parse>[1]);
}

/** The file text for an export (numbers read with parseExact are written back as they were). */
export function stringifyExport(data: CompanyExport): string {
  return JSON.stringify(data);
}

/** Reads a file written by stringifyExport. */
export function parseExport(text: string): unknown {
  return parseExact(text);
}

/** The company's own Self-Auth accounts ($1 = company id). */
const COMPANY_ACCOUNTS = `(select id from self_auth."user" where "companyId" = $1::text)`;

/**
 * Account tables, in load order (parents first), read before the company tables. `key` holds the user id;
 * `where` selects the company's rows; `nullColumns` are never exported (OAuth tokens: Google sign-in needs only
 * the link, and tokens are credentials). Sessions are not exported: people sign in again.
 */
export const ACCOUNT_TABLES = [
  { table: 'self_auth.user', key: 'id', where: `t."companyId" = $1::text` },
  {
    table: 'self_auth.account', key: 'userId', where: `t."userId" in ${COMPANY_ACCOUNTS}`,
    nullColumns: ['accessToken', 'refreshToken', 'idToken', 'accessTokenExpiresAt', 'refreshTokenExpiresAt'],
  },
  { table: 'self_auth.totp_factor', key: 'user_id', where: `t.user_id in ${COMPANY_ACCOUNTS}` },
  { table: 'public.profiles', key: 'user_id', where: 't.user_id in (select user_id from public.company_members where company_id = $1)' },
] as const satisfies readonly { table: string; key: string; where: string; nullColumns?: readonly string[] }[];
export const ACCOUNT_TABLE_NAMES: string[] = ACCOUNT_TABLES.map((a) => a.table);

export const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`;
/** `schema.table` as written by this module, quoted for SQL. */
export const quoteTable = (qualified: string) => qualified.split('.').map(quoteIdent).join('.');

/** Parents before children (an edge is [child, parent]); ties by name; throws on a cycle. */
export function sortTables(names: string[], edges: [string, string][]): string[] {
  const parents = new Map(names.map((n) => [n, new Set<string>()]));
  for (const [child, parent] of edges) if (child !== parent && parents.has(child) && parents.has(parent)) parents.get(child)!.add(parent);
  const out: string[] = [];
  const left = new Set(names);
  while (left.size) {
    const ready = [...left].filter((n) => [...parents.get(n)!].every((p) => !left.has(p))).sort();
    if (!ready.length) throw new Error(`Foreign keys form a cycle between: ${[...left].sort().join(', ')}`);
    for (const n of ready) {
      out.push(n);
      left.delete(n);
    }
  }
  return out;
}

/** Every company table as `schema.table`, parents before children. */
export async function companyTableOrder(c: Client): Promise<string[]> {
  const tables = await c.query<{ t: string }>(`
    select n.nspname || '.' || k.relname as t from app.company_tables() x
    join pg_class k on k.oid = x join pg_namespace n on n.oid = k.relnamespace`);
  const names = tables.rows.map((r) => r.t);
  const fks = await c.query<{ child: string; parent: string }>(`
    select cn.nspname || '.' || cc.relname as child, pn.nspname || '.' || pc.relname as parent
    from pg_constraint f
    join pg_class cc on cc.oid = f.conrelid join pg_namespace cn on cn.oid = cc.relnamespace
    join pg_class pc on pc.oid = f.confrelid join pg_namespace pn on pn.oid = pc.relnamespace
    where f.contype = 'f' and f.conrelid in (select app.company_tables()) and f.confrelid in (select app.company_tables())`);
  return sortTables(names, fks.rows.map((r) => [r.child, r.parent]));
}

/** Insertable columns of a table (generated ones are recomputed). */
export async function insertableColumns(c: Client, qualified: string): Promise<string[]> {
  const { rows } = await c.query<{ name: string }>(`
    select a.attname as name from pg_attribute a
    where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' order by a.attnum`,
  [quoteTable(qualified)]);
  return rows.map((r) => r.name);
}

/** Reads one company's data. Callers must give it one consistent snapshot (begin isolation level repeatable read read only), or the ~50 reads see different moments. Runs on the caller's connection and transaction (no session needed: it filters on company_id). */
export async function exportCompany(c: Client, companyId: string): Promise<CompanyExport> {
  const tables: Record<string, Row[]> = {};
  const read = async (qualified: string, where: string, nullColumns: readonly string[] = []) => {
    const { rows } = await c.query<{ r: string }>(
      `select to_jsonb(t)::text as r from ${quoteTable(qualified)} t where ${where} order by to_jsonb(t)`, [companyId]);
    tables[qualified] = rows.map((x) => {
      const row = parseExact(x.r) as Row;
      for (const col of nullColumns) if (col in row) row[col] = null;
      return row;
    });
  };
  const company = (await c.query<{ r: string }>('select to_jsonb(t)::text as r from public.companies t where t.id = $1', [companyId])).rows[0];
  if (!company) throw new Error(`Company ${companyId} does not exist in this database.`);
  for (const a of ACCOUNT_TABLES) await read(a.table, a.where, 'nullColumns' in a ? a.nullColumns : []);
  for (const t of await companyTableOrder(c)) await read(t, 't.company_id = $1');
  return {
    format: 'company-export-v2', company_id: companyId, exported_at: new Date().toISOString(), company: parseExact(company.r) as Row, tables,
  };
}

/** Removes `flag <value>` from argv. */
export function takeFileArg(argv: string[], flag: string): { file: string; rest: string[] } {
  const i = argv.indexOf(flag);
  const file = argv[i + 1];
  if (i === -1 || !file || (file.startsWith('--') && file !== '-')) throw new Error(`Usage: ${flag} <file>`);
  return { file, rest: [...argv.slice(0, i), ...argv.slice(i + 2)] };
}

/** The company's id in the one database (exits 3 when the slug is unknown). */
export async function companyIdOf(c: Client, slug: string): Promise<string> {
  return companyIdBySlug(c, slug);
}

async function main() {
  const usage = 'Usage: npm run company:export -- --company <slug> --out <file | ->';
  const { file, rest } = takeFileArg(process.argv.slice(2), '--out');
  const { slug } = takeCompanyArg(rest);
  if (!slug) throw new Error(usage);
  // To stdout the data would mix with the log: `--out -` streams the JSON and logs to stderr.
  console.error(`Target project: ${targetLabel(process.env.NEXT_PUBLIC_SUPABASE_URL)}`);
  const c = new Client(pgConfig());
  await c.connect();
  try {
    const companyId = await companyIdOf(c, slug);
    await c.query('begin isolation level repeatable read read only');
    const data = await exportCompany(c, companyId);
    await c.query('commit');
    const text = stringifyExport(data);
    if (file === '-') process.stdout.write(text);
    else writeFileSync(file, text, { mode: 0o600 });
    const rows = Object.values(data.tables).reduce((n, t) => n + t.length, 0);
    console.error(`Exported ${rows} rows from ${Object.keys(data.tables).length} tables of ${slug} (${companyId})${file === '-' ? '' : ` to ${file}`}`);
  } finally {
    await c.end();
  }
}

if (process.argv[1]?.endsWith('company-export.ts')) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(e instanceof UnknownCompanyError ? 3 : 1);
  });
}

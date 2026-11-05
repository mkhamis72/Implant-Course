import './load-env';
import { writeFileSync } from 'node:fs';
import { Client } from 'pg';
import { pgConfig } from './db';
import { applyTenantArg, takeTenantArg, withControl } from './tenant-env';
import { tenantCompanyId } from './tenants';

export type Row = Record<string, unknown>;

/** One company's data: its rows from every company table (parents before children), preceded by its
 *  members' sign-in accounts and profiles. Holds password hashes: keep it as private as a database dump. */
export type CompanyExport = {
  format: 'company-export-v1';
  company_id: string;
  exported_at: string;
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

export const ACCOUNT_TABLES = ['auth.users', 'public.profiles'] as const;
/** The column holding the user id in each account table. */
export const ACCOUNT_KEY: Record<(typeof ACCOUNT_TABLES)[number], string> = { 'auth.users': 'id', 'public.profiles': 'user_id' };

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
  const members = '(select user_id from public.company_members where company_id = $1)';
  const tables: Record<string, Row[]> = {};
  const read = async (qualified: string, where: string) => {
    const { rows } = await c.query<{ r: string }>(
      `select to_jsonb(t)::text as r from ${quoteTable(qualified)} t where ${where} order by to_jsonb(t)`, [companyId]);
    tables[qualified] = rows.map((x) => parseExact(x.r) as Row);
  };
  for (const t of ACCOUNT_TABLES) await read(t, `t.${ACCOUNT_KEY[t]} in ${members}`);
  for (const t of await companyTableOrder(c)) await read(t, 't.company_id = $1');
  return { format: 'company-export-v1', company_id: companyId, exported_at: new Date().toISOString(), tables };
}

/** Removes `flag <value>` from argv. */
export function takeFileArg(argv: string[], flag: string): { file: string; rest: string[] } {
  const i = argv.indexOf(flag);
  const file = argv[i + 1];
  if (i === -1 || !file || (file.startsWith('--') && file !== '-')) throw new Error(`Usage: ${flag} <file>`);
  return { file, rest: [...argv.slice(0, i), ...argv.slice(i + 2)] };
}

/** The company id the control registry holds for the slug. */
export class NoCompanyIdError extends Error {}

export async function companyIdOf(slug: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const id = await withControl(env, (c) => tenantCompanyId(c, slug));
  if (!id) throw new NoCompanyIdError(`Company ${slug} has no company id in the control project; register it with --company or --provision.`);
  return id;
}

async function main() {
  const usage = 'Usage: npm run company:export -- --tenant <slug> --out <file | ->';
  const { file, rest } = takeFileArg(process.argv.slice(2), '--out');
  const { slug } = takeTenantArg(rest);
  if (!slug) throw new Error(usage);
  const companyId = await companyIdOf(slug);
  const { label } = await applyTenantArg(rest, process.env, (line) => console.error(line));
  // To stdout the data would mix with the log: `--out -` streams the JSON and logs to stderr.
  console.error(`Target project: ${label}`);
  const c = new Client(pgConfig());
  await c.connect();
  try {
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
    process.exit(e instanceof NoCompanyIdError ? 3 : 1);
  });
}

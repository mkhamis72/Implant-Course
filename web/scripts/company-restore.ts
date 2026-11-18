import './load-env';
import { readFileSync, writeFileSync } from 'node:fs';
import { Client } from 'pg';
import { pgConfig } from './db';
import { takeCompanyArg, UnknownCompanyError } from './one-database';
import { targetLabel } from './create-user-args';
import {
  ACCOUNT_TABLE_NAMES, ACCOUNT_TABLES, companyIdOf, companyTableOrder, insertableColumns, parseExport, quoteIdent, quoteTable, takeFileArg,
  type CompanyExport, type Row,
} from './company-export';

/*
 * For one company in a shared database (see the limits in company-export.ts): former members'
 * profiles are not in the file, identity sequences are not advanced, and files' bytes are held in memory as hex.
 * Suspend the company first (docs/operations.md section D): writes during the delete-and-reload would be lost.
 */
const CHUNK = 2000;

/** An export written before 2026-11-16. */
export type V1Export = { format: 'company-export-v1'; company_id: string; exported_at: string; tables: Record<string, Row[]> };

/** Throws unless `data` is a company export (v1 or v2) for exactly this company. */
export function checkCompanyFile(data: unknown, companyId: string): asserts data is CompanyExport | V1Export {
  const d = data as Partial<CompanyExport | V1Export> | null;
  if (!d || (d.format !== 'company-export-v1' && d.format !== 'company-export-v2') || typeof d.tables !== 'object' || !d.tables) {
    throw new Error('The file is not a company export.');
  }
  if (d.company_id !== companyId) throw new Error(`The file is for company ${d.company_id}, not ${companyId}: nothing was restored.`);
}

/** Every foreign key of the company's rows must find its parent: with triggers off nothing else checks. */
async function foreignKeyProblems(c: Client, companyId: string): Promise<string[]> {
  const { rows: fks } = await c.query<{ child: string; parent: string; name: string; pairs: { c: string; p: string }[] }>(`
    select cn.nspname || '.' || cc.relname as child, pn.nspname || '.' || pc.relname as parent, f.conname as name,
      (select jsonb_agg(jsonb_build_object('c', ca.attname, 'p', pa.attname) order by k.ord)
       from unnest(f.conkey, f.confkey) with ordinality as k(c, p, ord)
       join pg_attribute ca on ca.attrelid = f.conrelid and ca.attnum = k.c
       join pg_attribute pa on pa.attrelid = f.confrelid and pa.attnum = k.p) as pairs
    from pg_constraint f
    join pg_class cc on cc.oid = f.conrelid join pg_namespace cn on cn.oid = cc.relnamespace
    join pg_class pc on pc.oid = f.confrelid join pg_namespace pn on pn.oid = pc.relnamespace
    where f.contype = 'f' and f.conrelid in (select app.company_tables())`);
  const problems: string[] = [];
  for (const fk of fks) {
    const present = fk.pairs.map((p) => `c.${quoteIdent(p.c)} is not null`).join(' and ');
    const match = fk.pairs.map((p) => `p.${quoteIdent(p.p)} = c.${quoteIdent(p.c)}`).join(' and ');
    const { rows } = await c.query<{ n: number }>(
      `select count(*)::int as n from ${quoteTable(fk.child)} c where c.company_id = $1 and ${present}
       and not exists (select 1 from ${quoteTable(fk.parent)} p where ${match})`, [companyId]);
    if (rows[0].n) problems.push(`${fk.child} (${fk.name}): ${rows[0].n} row(s) without their ${fk.parent} row`);
  }
  return problems;
}

/**
 * Switches off the triggers that would alter or refuse restored rows (audit, append-only ledger, column
 * defaults, account triggers) for the rest of the transaction with SET LOCAL session_replication_role = replica
 * (Ruling 23; no locks) and returns the function that restores the previous setting. The plain statement is
 * needed: set_config() is refused to postgres by Supabase. A refusal fails the restore.
 */
async function triggersOff(c: Client): Promise<() => Promise<void>> {
  const previous = (await c.query<{ v: string }>(`select current_setting('session_replication_role') as v`)).rows[0].v;
  try {
    await c.query('set local session_replication_role = replica');
  } catch (error) {
    throw new Error(`The database role may not set session_replication_role, which a restore needs: ${(error as Error).message}`);
  }
  return async () => { await c.query(`set local session_replication_role = ${quoteIdent(previous)}`); };
}

/** A v1 file (before 2026-11-16: `auth.users`, no self_auth tables, no company row) as a v2 one. */
export function normalizeExport(data: CompanyExport | V1Export): Omit<CompanyExport, 'company'> & { company: Row | null } {
  if (data.format === 'company-export-v2') return data;
  const tables = Object.fromEntries(Object.entries(data.tables).filter(([t]) => t !== 'auth.users'));
  for (const t of ACCOUNT_TABLE_NAMES) tables[t] ??= [];
  return { format: 'company-export-v2', company_id: data.company_id, exported_at: data.exported_at, company: null, tables };
}

/** The file's account rows must all be the company's: its own Self-Auth users, their passwords, Google links and
 *  authenticators, and its members' profiles. */
function checkAccounts(tables: Record<string, Row[]>, companyId: string): void {
  const users = new Set<unknown>();
  for (const u of tables['self_auth.user']) {
    if (u.companyId !== companyId) throw new Error(`self_auth.user row ${String(u.id)} belongs to another company (${String(u.companyId)}): nothing was restored.`);
    users.add(u.id);
  }
  for (const a of ACCOUNT_TABLES) {
    if (a.table === 'self_auth.user' || a.table === 'public.profiles') continue;
    for (const row of tables[a.table]) {
      if (!users.has(row[a.key])) throw new Error(`${a.table} row for ${String(row[a.key])} is not an account of the company in the file: nothing was restored.`);
    }
  }
  const members = new Set(tables['public.company_members'].map((r) => r.user_id));
  for (const row of tables['public.profiles']) {
    if (!members.has(row.user_id)) throw new Error(`public.profiles row ${String(row.user_id)} is not a member of the company in the file`);
  }
}

/** Puts back a deleted company's own row from the file (restore --create), refusing a slug or address now taken. */
async function createCompany(c: Client, company: Row | null, companyId: string): Promise<string> {
  if (!company) throw new Error('The file has no company row (an export from before 2026-11-16): it cannot rebuild a deleted company.');
  if (company.id !== companyId) throw new Error(`The file's company row is ${String(company.id)}, not ${companyId}: nothing was restored.`);
  if ((await c.query('select 1 from public.companies where slug = $1', [company.slug])).rowCount) {
    throw new Error(`The slug ${String(company.slug)} belongs to another company now: nothing was restored.`);
  }
  const hosts = Array.isArray(company.hosts) ? company.hosts : [];
  const taken = (await c.query<{ slug: string; host: string }>(
    'select x.slug, h as host from public.companies x, unnest(x.hosts) h where h = any($1::text[]) order by 2 limit 1', [hosts])).rows[0];
  if (taken) throw new Error(`The address ${taken.host} belongs to another company now (${taken.slug}): nothing was restored.`);
  // Only columns the file has: one it lacks (an export from before 0109) takes its column default.
  const cols = (await insertableColumns(c, 'public.companies')).filter((k) => k in company).map(quoteIdent).join(', ');
  await c.query(`insert into public.companies (${cols}) select ${cols} from jsonb_populate_record(null::public.companies, $1::jsonb)`,
    [JSON.stringify(company)]);
  return `created the company row ${String(company.slug)} from the file`;
}

/**
 * Replaces one company's rows with the file's, on the caller's connection and inside the caller's
 * transaction (the CLI wraps begin/commit; a throw leaves everything to roll back). Only that company's rows
 * are deleted (company tables, in reverse FK order, including its company_members); its sign-in accounts and
 * its members' profiles are inserted if missing and never changed (a password changed since the export stays).
 * With `create`, a company that no longer exists (fully erased) first gets its companies row back from the file.
 * Triggers are off for the load (triggersOff), so rows come back identical;
 * foreign keys are then re-checked by query. Returns a log line per table.
 */
export async function restoreCompany(c: Client, companyId: string, input: unknown, opts: { create?: boolean } = {}): Promise<string[]> {
  checkCompanyFile(input, companyId);
  const data = normalizeExport(input);
  const order = await companyTableOrder(c);
  const expected = [...ACCOUNT_TABLE_NAMES, ...order].sort();
  const given = Object.keys(data.tables).sort();
  if (expected.join() !== given.join()) {
    const diff = [...expected.filter((t) => !given.includes(t)).map((t) => `missing ${t}`), ...given.filter((t) => !expected.includes(t)).map((t) => `unknown ${t}`)];
    throw new Error(`The file does not match this database's company tables (${diff.join(', ')}): nothing was restored.`);
  }
  for (const t of order) {
    data.tables[t].forEach((row, i) => {
      if (row.company_id !== companyId) throw new Error(`${t} row ${i + 1}: company_id is ${String(row.company_id)}, not ${companyId}`);
    });
  }
  checkAccounts(data.tables, companyId);
  const exists = !!(await c.query('select 1 from public.companies where id = $1', [companyId])).rowCount;
  const log: string[] = [];
  if (opts.create) {
    if (exists) throw new Error(`Company ${companyId} already exists: restore it without --create.`);
    log.push(await createCompany(c, data.company, companyId));
  } else if (!exists) {
    throw new Error(`Company ${companyId} does not exist in this database: nothing was restored. To rebuild a deleted company from its file, use --create.`);
  }

  const triggersBack = await triggersOff(c);
  // No try/finally: after an error the transaction is dead and the caller's rollback undoes the switch.
  for (const t of [...order].reverse()) {
    const { rowCount } = await c.query(`delete from ${quoteTable(t)} where company_id = $1`, [companyId]);
    log.push(`deleted ${rowCount} from ${t}`);
  }
  const load = async (t: string, rows: Row[], onConflict: boolean) => {
    const cols = (await insertableColumns(c, t)).map(quoteIdent).join(', ');
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { rowCount } = await c.query(
        `insert into ${quoteTable(t)} (${cols}) overriding system value
         select ${cols} from jsonb_populate_recordset(null::${quoteTable(t)}, $1::jsonb)${onConflict ? ' on conflict do nothing' : ''}`,
        [JSON.stringify(rows.slice(i, i + CHUNK))]);
      inserted += rowCount ?? 0;
    }
    log.push(`inserted ${inserted} of ${rows.length} into ${t}${onConflict ? ' (existing rows kept)' : ''}`);
  };
  for (const t of ACCOUNT_TABLE_NAMES) await load(t, data.tables[t], true);
  for (const t of order) await load(t, data.tables[t], false);
  await triggersBack();
  const problems = [...await foreignKeyProblems(c, companyId), ...await accountProblems(c, companyId)];
  if (problems.length) throw new Error(`Foreign key check failed after the restore, rolled back: ${problems.join('; ')}`);
  log.push('foreign keys checked');
  return log;
}

/** With triggers off nothing checked the account rows' keys either: every member's profile needs its Self-Auth user. */
async function accountProblems(c: Client, companyId: string): Promise<string[]> {
  const { rows } = await c.query<{ n: number }>(`
    select count(*)::int as n from public.profiles p
    where p.user_id in (select user_id from public.company_members where company_id = $1)
      and not exists (select 1 from self_auth."user" u where u.id = p.user_id)`, [companyId]);
  return rows[0].n ? [`public.profiles (profiles_user_id_fkey): ${rows[0].n} member profile(s) without their self_auth.user row`] : [];
}

/** A file with every table empty: restoring it deletes the company's rows (a data-protection erasure). */
export async function emptyExport(c: Client, companyId: string): Promise<CompanyExport> {
  const tables: Record<string, Row[]> = {};
  for (const t of [...ACCOUNT_TABLE_NAMES, ...(await companyTableOrder(c))]) tables[t] = [];
  const company = (await c.query<{ r: Row }>('select to_jsonb(t) as r from public.companies t where t.id = $1', [companyId])).rows[0]?.r ?? {};
  return { format: 'company-export-v2', company_id: companyId, exported_at: new Date().toISOString(), company, tables };
}

async function main() {
  const usage = 'Usage: npm run company:restore -- --company <slug> (--in <file> [--create] | --delete)';
  const erase = process.argv.includes('--delete');
  const create = process.argv.includes('--create');
  if (erase && process.argv.includes('--in')) throw new Error('Use --delete or --in, not both.');
  if (create && erase) throw new Error('--create rebuilds a company from a file: use it with --in, not --delete.');
  const argv = process.argv.slice(2).filter((a) => a !== '--delete' && a !== '--create');
  const { file, rest } = erase ? { file: `company-erase-${new Date().toISOString().slice(0, 10)}`, rest: argv } : takeFileArg(argv, '--in');
  const { slug } = takeCompanyArg(rest);
  if (!slug) throw new Error(usage);
  console.log(`Target project: ${targetLabel(process.env.NEXT_PUBLIC_SUPABASE_URL)}`);
  const c = new Client(pgConfig());
  await c.connect();
  try {
    // --create: the company is gone, so its id and slug come from the file (the slug given must match it).
    const fromFile = erase ? null : parseExport(readFileSync(file, 'utf8'));
    let companyId: string;
    if (create) {
      const f = fromFile as Partial<CompanyExport> | null;
      if (!f?.company_id || f.company?.slug !== slug) {
        throw new Error(`The file is not an export of ${slug} with its company row (company-export-v2): nothing was restored.`);
      }
      companyId = f.company_id;
    } else {
      companyId = await companyIdOf(c, slug).catch((e: unknown) => {
        if (e instanceof UnknownCompanyError && !erase) {
          throw new Error(`${e.message}. To rebuild a deleted company from its export, add --create.`);
        }
        throw e;
      });
    }
    const data = fromFile ?? await emptyExport(c, companyId);
    checkCompanyFile(data, companyId);
    const logFile = `${file}.restore.log`;
    await c.query('begin');
    let log: string[];
    try {
      log = await restoreCompany(c, companyId, data, { create });
      await c.query('commit');
    } catch (error) {
      await c.query('rollback');
      throw error;
    }
    const text = [`${erase ? 'Erased' : 'Restored'} ${slug} (${companyId})${erase ? '' : ` from ${file}`}`, ...log].join('\n');
    writeFileSync(logFile, `${text}\n`);
    console.log(`${text}\nLog written to ${logFile}`);
  } finally {
    await c.end();
  }
}

if (process.argv[1]?.endsWith('company-restore.ts')) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

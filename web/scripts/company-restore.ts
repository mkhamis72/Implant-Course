import './load-env';
import { readFileSync, writeFileSync } from 'node:fs';
import { Client } from 'pg';
import { pgConfig } from './db';
import { applyTenantArg, takeTenantArg } from './tenant-env';
import {
  ACCOUNT_KEY, ACCOUNT_TABLES, companyIdOf, companyTableOrder, insertableColumns, parseExport, quoteIdent, quoteTable, takeFileArg,
  type CompanyExport, type Row,
} from './company-export';

const CHUNK = 2000;

/** Throws unless `data` is a company export for exactly this company. */
export function checkCompanyFile(data: unknown, companyId: string): asserts data is CompanyExport {
  const d = data as Partial<CompanyExport> | null;
  if (!d || d.format !== 'company-export-v1' || typeof d.tables !== 'object' || !d.tables) {
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
 * defaults) for the rest of the transaction and returns the function that switches them back on.
 * session_replication_role = replica does it without locks (Ruling 23); a role that may not set it (the
 * local stack's postgres) disables the user triggers of the company tables instead, which locks them until
 * the transaction ends. Either way a rollback undoes it.
 */
async function triggersOff(c: Client, tables: string[]): Promise<() => Promise<void>> {
  const previous = (await c.query<{ v: string }>(`select current_setting('session_replication_role') as v`)).rows[0].v;
  await c.query('savepoint restore_triggers');
  try {
    await c.query(`select set_config('session_replication_role', 'replica', true)`);
    await c.query('release savepoint restore_triggers');
    return async () => { await c.query(`select set_config('session_replication_role', $1, true)`, [previous]); };
  } catch (error) {
    if ((error as { code?: string }).code !== '42501') throw error;
    await c.query('rollback to savepoint restore_triggers');
  }
  for (const t of tables) await c.query(`alter table ${quoteTable(t)} disable trigger user`);
  return async () => { for (const t of tables) await c.query(`alter table ${quoteTable(t)} enable trigger user`); };
}

/**
 * Replaces one company's rows with the file's, on the caller's connection and inside the caller's
 * transaction (the CLI wraps begin/commit; a throw leaves everything to roll back). Only that company's rows
 * are deleted (company tables, in reverse FK order, including its company_members); the members' profiles and
 * accounts are inserted if missing and never touched, since a person can belong to another company.
 * Triggers are off for the load (triggersOff), so rows come back identical;
 * foreign keys are then re-checked by query. Returns a log line per table.
 */
export async function restoreCompany(c: Client, companyId: string, data: unknown): Promise<string[]> {
  checkCompanyFile(data, companyId);
  const order = await companyTableOrder(c);
  const expected = [...ACCOUNT_TABLES, ...order].sort();
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
  const members = new Set(data.tables['public.company_members'].map((r) => r.user_id));
  for (const t of ACCOUNT_TABLES) {
    for (const row of data.tables[t]) {
      if (!members.has(row[ACCOUNT_KEY[t]])) throw new Error(`${t} row ${String(row[ACCOUNT_KEY[t]])} is not a member of the company in the file`);
    }
  }
  if (!(await c.query('select 1 from public.companies where id = $1', [companyId])).rowCount) {
    throw new Error(`Company ${companyId} does not exist in this database: nothing was restored.`);
  }

  const log: string[] = [];
  const triggersBack = await triggersOff(c, order);
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
  for (const t of ACCOUNT_TABLES) await load(t, data.tables[t], true);
  for (const t of order) await load(t, data.tables[t], false);
  await triggersBack();
  const problems = await foreignKeyProblems(c, companyId);
  if (problems.length) throw new Error(`Foreign key check failed after the restore, rolled back: ${problems.join('; ')}`);
  log.push('foreign keys checked');
  return log;
}

/** A file with every table empty: restoring it deletes the company's rows (a data-protection erasure). */
export async function emptyExport(c: Client, companyId: string): Promise<CompanyExport> {
  const tables: Record<string, Row[]> = {};
  for (const t of [...ACCOUNT_TABLES, ...(await companyTableOrder(c))]) tables[t] = [];
  return { format: 'company-export-v1', company_id: companyId, exported_at: new Date().toISOString(), tables };
}

async function main() {
  const usage = 'Usage: npm run company:restore -- --tenant <slug> (--in <file> | --delete)';
  const erase = process.argv.includes('--delete');
  const { file, rest } = erase ? { file: `company-erase-${new Date().toISOString().slice(0, 10)}`, rest: process.argv.slice(2).filter((a) => a !== '--delete') } : takeFileArg(process.argv.slice(2), '--in');
  const { slug } = takeTenantArg(rest);
  if (!slug) throw new Error(usage);
  const companyId = await companyIdOf(slug);
  const { label } = await applyTenantArg(rest, process.env);
  console.log(`Target project: ${label}`);
  const c = new Client(pgConfig());
  await c.connect();
  try {
    const data = erase ? await emptyExport(c, companyId) : parseExport(readFileSync(file, 'utf8'));
    checkCompanyFile(data, companyId);
    const logFile = `${file}.restore.log`;
    await c.query('begin');
    let log: string[];
    try {
      log = await restoreCompany(c, companyId, data);
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

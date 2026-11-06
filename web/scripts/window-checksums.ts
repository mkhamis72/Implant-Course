import './load-env';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { pgConfig } from './db';
import { applyTenantArg } from './tenant-env';

/**
 * Release 4 window checks. Per table in public / app_private / app / auth: the row count and, per column, the md5 of that
 * column's values ordered by primary key (company_id excluded everywhere). Append-only tables (APPEND_ONLY_TABLES) are
 * hashed row by row instead: a row that existed before must be unchanged after, new rows are only reported. Per-column hashes name the column that differs; a column
 * present on one side only fails unless it is in EXPECTED_SCHEMA_CHANGES.
 *   window-checksums [--tenant academy] --out <file>
 *   window-checksums --compare <before> <after>
 */
export type TableSum = { rows: number; columns: Record<string, string>; rowHashes?: Record<string, string> };
export type Checksums = { target: string; tables: Record<string, TableSum> };

export type SchemaChange = {
  table: string;
  kind: 'table-added' | 'table-removed' | 'column-added' | 'column-removed' | 'data-changed';
  column?: string;
  migration: string;
};

/** Differences the window is expected to make. Anything else only on one side, or different, fails the compare. */
export const EXPECTED_SCHEMA_CHANGES: SchemaChange[] = [
  { table: 'app_private.file_no_counters', kind: 'table-added', migration: '0091_company_keys' },
  { table: 'app_private.schema_migrations', kind: 'data-changed', migration: 'runner: records 0089-0095' },
];

/**
 * Append-only tables and their key: each row is hashed (md5 of the row as jsonb, company_id excluded). Rows present before
 * must be present and unchanged after; rows only after (the migrations write audit rows) are reported, never failed.
 */
export const APPEND_ONLY_TABLES: Record<string, string> = { 'public.audit_log': 'id' };

/** Reported, never failed: they grow or change on their own (sign-ins, token refresh). */
export const REPORT_ONLY_TABLES = [
  'auth.sessions',
  'auth.refresh_tokens',
  'auth.audit_log_entries',
  'auth.mfa_challenges',
  'auth.flow_state',
  'auth.one_time_tokens',
];

export type CompareResult = { ok: boolean; differences: string[]; reported: string[]; expected: string[] };

/** Pure: compare two checksum files. */
export function compareChecksums(before: Checksums, after: Checksums, expectedList: SchemaChange[] = EXPECTED_SCHEMA_CHANGES): CompareResult {
  const differences: string[] = [];
  const reported: string[] = [];
  const expected: string[] = [];
  const find = (table: string, kind: SchemaChange['kind'], column?: string) =>
    expectedList.find((e) => e.table === table && e.kind === kind && e.column === column);
  const note = (table: string, kind: SchemaChange['kind'], text: string, column?: string) => {
    const e = find(table, kind, column);
    if (e) expected.push(`${text} (expected, ${e.migration})`);
    else differences.push(text);
  };

  for (const table of [...new Set([...Object.keys(before.tables), ...Object.keys(after.tables)])].sort()) {
    const b = before.tables[table];
    const a = after.tables[table];
    if (!b) {
      note(table, 'table-added', `${table}: table only after`);
      continue;
    }
    if (!a) {
      if (REPORT_ONLY_TABLES.includes(table)) reported.push(`${table}: table only before`);
      else note(table, 'table-removed', `${table}: table only before`);
      continue;
    }
    if (table in APPEND_ONLY_TABLES) {
      compareRows(table, b, a, differences, reported);
      for (const c of [...new Set([...Object.keys(b.columns), ...Object.keys(a.columns)])].sort()) {
        if (!(c in b.columns)) note(table, 'column-added', `${table}: column ${c} only after`, c);
        else if (!(c in a.columns)) note(table, 'column-removed', `${table}: column ${c} only before`, c);
      }
      continue;
    }
    const lines: string[] = [];
    if (a.rows !== b.rows) lines.push(`${table}: rows ${b.rows} -> ${a.rows}`);
    const schemaLines: { kind: SchemaChange['kind']; text: string; column: string }[] = [];
    for (const c of [...new Set([...Object.keys(b.columns), ...Object.keys(a.columns)])].sort()) {
      if (!(c in b.columns)) schemaLines.push({ kind: 'column-added', text: `${table}: column ${c} only after`, column: c });
      else if (!(c in a.columns)) schemaLines.push({ kind: 'column-removed', text: `${table}: column ${c} only before`, column: c });
      else if (a.columns[c] !== b.columns[c]) lines.push(`${table}.${c}: hash differs`);
    }
    if (REPORT_ONLY_TABLES.includes(table)) {
      for (const l of [...lines, ...schemaLines.map((s) => s.text)]) reported.push(l);
      continue;
    }
    for (const l of lines) note(table, 'data-changed', l);
    for (const s of schemaLines) note(table, s.kind, s.text, s.column);
  }
  return { ok: differences.length === 0, differences, reported, expected };
}

/** Append-only table: every row before must be unchanged after; rows only after are counted and reported. */
function compareRows(table: string, b: TableSum, a: TableSum, differences: string[], reported: string[]) {
  if (!b.rowHashes || !a.rowHashes) {
    differences.push(`${table}: no row hashes on ${b.rowHashes ? 'the after' : 'the before'} side (take both files with this version of the script)`);
    return;
  }
  const after = a.rowHashes;
  const bad: string[] = [];
  for (const [id, h] of Object.entries(b.rowHashes)) {
    if (!(id in after)) bad.push(`${id} missing after`);
    else if (after[id] !== h) bad.push(`${id} differs`);
  }
  if (bad.length) differences.push(`${table}: ${bad.length} earlier row(s) changed: ${bad.slice(0, 20).join(', ')}${bad.length > 20 ? ', ...' : ''}`);
  const added = Object.keys(after).filter((id) => !(id in b.rowHashes!)).length;
  reported.push(`${table}: ${added} new row(s), ${Object.keys(b.rowHashes).length} earlier row(s) ${bad.length ? 'checked' : 'unchanged'}`);
}

/** SQL for an append-only table: one md5 per row (the row as jsonb without company_id), keyed by `key`. */
export function rowHashSql(schema: string, table: string, key: string): string {
  return `select ${q(key)}::text as id, md5((to_jsonb(t) - 'company_id')::text) as h from ${q(schema)}.${q(table)} t`;
}

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

/**
 * SQL for one table: the row count and one md5 per column (alias c0, c1 ...), company_id excluded. Rows are ordered by the
 * primary key without company_id, or by every column but company_id when that leaves no key (a key that is only
 * company_id, or no key).
 */
export function hashSql(schema: string, table: string, columns: string[], pk: string[]): string {
  const cols = columns.filter((c) => c !== 'company_id');
  const key = pk.filter((c) => c !== 'company_id');
  const order = key.length ? key.map(q).join(', ') : cols.map((c) => `${q(c)}::text`).join(', ');
  const parts = cols.map(
    (c, i) => `md5(coalesce(string_agg(coalesce(md5(${q(c)}::text), '~'), ',' order by ${order}), '')) as c${i}`,
  );
  return `select count(*)::int as rows${parts.length ? ', ' : ''}${parts.join(', ')} from ${q(schema)}.${q(table)}`;
}

async function collect(c: Client): Promise<Record<string, TableSum>> {
  const { rows: tables } = await c.query(
    `select n.nspname as schema, c.relname as name, c.oid::int as oid
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r','p') and n.nspname in ('public','app_private','app','auth') order by 1, 2`,
  );
  const out: Record<string, TableSum> = {};
  for (const t of tables) {
    const cols = (
      await c.query('select attname from pg_attribute where attrelid = $1 and attnum > 0 and not attisdropped order by attnum', [t.oid])
    ).rows.map((r) => r.attname as string);
    const pk = (
      await c.query(
        `select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
          where i.indrelid = $1 and i.indisprimary order by array_position(i.indkey::int2[], a.attnum)`,
        [t.oid],
      )
    ).rows.map((r) => r.attname as string);
    const row = (await c.query(hashSql(t.schema, t.name, cols, pk))).rows[0];
    const hashed = cols.filter((x) => x !== 'company_id');
    const name = `${t.schema}.${t.name}`;
    out[name] = { rows: row.rows, columns: Object.fromEntries(hashed.map((col, i) => [col, row[`c${i}`] as string])) };
    if (name in APPEND_ONLY_TABLES) {
      const r = await c.query(rowHashSql(t.schema, t.name, APPEND_ONLY_TABLES[name]));
      out[name].rowHashes = Object.fromEntries(r.rows.map((x) => [x.id as string, x.h as string]));
    }
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--compare')) {
    const i = argv.indexOf('--compare');
    const [bf, af] = [argv[i + 1], argv[i + 2]];
    if (!bf || !af) throw new Error('Usage: window-checksums --compare <before> <after>');
    const result = compareChecksums(JSON.parse(readFileSync(bf, 'utf8')), JSON.parse(readFileSync(af, 'utf8')));
    for (const l of result.expected) console.log(`EXPECTED ${l}`);
    for (const l of result.reported) console.log(`REPORTED ${l}`);
    for (const l of result.differences) console.log(`DIFFERENT ${l}`);
    console.log(result.ok ? 'PASS' : 'FAIL');
    process.exitCode = result.ok ? 0 : 1;
    return;
  }
  const i = argv.indexOf('--out');
  const outArg = argv[i + 1];
  if (i === -1 || !outArg || outArg.startsWith('--')) throw new Error('Usage: window-checksums [--tenant <slug>] --out <file>  |  --compare <before> <after>');
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
    const tables = await collect(c);
    await c.query('rollback');
    writeFileSync(out, JSON.stringify({ target: host, tables } satisfies Checksums, null, 1));
    console.log(`${Object.keys(tables).length} tables, ${Object.values(tables).reduce((n, t) => n + t.rows, 0)} rows -> ${out}`);
  } finally {
    await c.end();
  }
}

if (process.argv[1] && /window-checksums\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

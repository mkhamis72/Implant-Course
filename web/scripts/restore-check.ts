import './load-env';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import { pgConfig } from './db';
import { isLocalHost } from './test-guard';
import { countsSql, redact } from './pre-one-db-backup-lib';

const IMAGE = 'postgres:17';

export type CountCheck = { table: string; expected: number; actual: number | null; ok: boolean };

/** One line per expected table; a table missing from `actual` has `actual: null`. */
export function compareCounts(expected: Record<string, number>, actual: Record<string, number>): CountCheck[] {
  return Object.entries(expected).map(([table, exp]) => {
    const act = table in actual ? actual[table] : null;
    return { table, expected: exp, actual: act, ok: act === exp };
  });
}

function takeArg(argv: string[], name: string): string {
  const i = argv.indexOf(name);
  const v = argv[i + 1];
  if (i === -1 || !v || v.startsWith('--')) throw new Error('Usage: ENV_FILE=.env.dev2 npx tsx scripts/restore-check.ts --dump <full.dump> --counts <counts.json>');
  return path.resolve(v);
}

async function main() {
  const dump = takeArg(process.argv.slice(2), '--dump');
  const countsFile = takeArg(process.argv.slice(2), '--counts');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const host = new URL(url).hostname;
  console.log(`Target project: ${host}`);
  if (!isLocalHost(host)) throw new Error('Refusing to restore: the target must be a local stack (127.0.0.1). This check wipes the auth tables first.');

  const secrets = [url, decodeURIComponent(new URL(url).password), new URL(url).password];
  const dockerUrl = new URL(url);
  dockerUrl.hostname = 'host.docker.internal';
  const dockerEnv = { ...process.env, PGURL: dockerUrl.toString(), MSYS_NO_PATHCONV: '1' };
  const mounts = ['-v', `${path.dirname(dump)}:/in:ro`];
  const file = `/in/${path.basename(dump)}`;
  const restore = (args: string[], skipList = '') => {
    const r = spawnSync('docker', ['run', '--rm', '-e', 'PGURL', ...mounts, IMAGE, 'sh', '-c', `${skipList}pg_restore --dbname="$PGURL" "$@"`, '--', ...args, ...(skipList ? ['-L', '/tmp/list'] : []), file], { env: dockerEnv, encoding: 'utf8' });
    if (r.error) throw new Error(redact(`docker failed to start: ${r.error.message}`, secrets));
    const text = redact(`${r.stdout ?? ''}${r.stderr ?? ''}`, secrets).trim();
    if (r.status !== 0) throw new Error(`pg_restore exited ${r.status}${text ? `:\n${text}` : ''}`);
    if (text) console.log(text);
  };

  // Auth first: the app tables' foreign keys to auth.users need its rows. The stack's own auth tables hold only
  // bootstrap rows; empty them, then load the dump's rows. auth.schema_migrations belongs to the auth service
  // (not truncatable here) and the stack already filled it, so its dump rows are skipped.
  const c = new Client(pgConfig({ DATABASE_URL: url }));
  await c.connect();
  try {
    const { rows } = await c.query("select format('%I.%I', n.nspname, c.relname) as t from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'auth' and c.relkind = 'r' and c.relname <> 'schema_migrations'");
    if (rows.length) await c.query(`truncate ${rows.map((r) => r.t).join(', ')} cascade`);
  } finally {
    await c.end();
  }
  // A data-only restore has no foreign-key ordering without --disable-triggers (the role isn't the owner of the auth tables),
  // so users and sessions go first; the rest of the dump's order already satisfies the other keys.
  const authList = `{ pg_restore -l ${file} | grep ' TABLE DATA auth users '; pg_restore -l ${file} | grep ' TABLE DATA auth sessions '; pg_restore -l ${file} | grep -v -e ' auth schema_migrations ' -e ' TABLE DATA auth users ' -e ' TABLE DATA auth sessions '; } > /tmp/list; `;
  restore(['--no-owner', '--no-acl', '--data-only', '--schema=auth'], authList);

  // Then the un-migrated target gets schema and data of the app schemas. A --schema filter does not carry the
  // CREATE SCHEMA of app_private (public exists already), so create it first.
  const s = new Client(pgConfig({ DATABASE_URL: url }));
  await s.connect();
  try {
    await s.query('create schema if not exists app_private');
  } finally {
    await s.end();
  }
  restore(['--no-owner', '--no-acl', '--schema=public', '--schema=app_private']);

  const expected = Object.fromEntries((JSON.parse(readFileSync(countsFile, 'utf8')) as { table: string; rows: number }[]).map((r) => [r.table, r.rows]));
  const v = new Client(pgConfig({ DATABASE_URL: url }));
  await v.connect();
  let actual: Record<string, number>;
  try {
    actual = Object.fromEntries((await v.query(countsSql())).rows.map((r) => [r.table, Number(r.rows)]));
  } finally {
    await v.end();
  }

  const results = compareCounts(expected, actual);
  const bad = results.filter((r) => !r.ok);
  for (const r of bad) console.log(`MISMATCH ${r.table}: expected ${r.expected}, got ${r.actual ?? 'missing'}`);
  console.log(bad.length ? `FAIL ${results.length - bad.length}/${results.length}` : `PASS ${results.length}/${results.length}`);
  process.exit(bad.length ? 1 : 0);
}

if (process.argv[1] && /restore-check\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

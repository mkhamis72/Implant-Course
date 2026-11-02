import './load-env';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'dotenv';
import { Client } from 'pg';
import { pgConfig } from './db';
import { resolveEnvFile } from './env-file';
import { isLocalHost } from './test-guard';
import { applyTenantArg } from './tenant-env';
import { countsSql, pgDumpArgs, redact, settingsMarkdown } from './pre-one-db-backup-lib';

const IMAGE = 'postgres:17';

function takeOut(argv: string[]): { out: string; rest: string[] } {
  const i = argv.indexOf('--out');
  const out = argv[i + 1];
  if (i === -1 || !out || out.startsWith('--')) throw new Error('Usage: npm run backup:pre-one-db -- [--tenant <slug> | --control] --out <dir>');
  return { out: path.resolve(out), rest: [...argv.slice(0, i), ...argv.slice(i + 2)] };
}

async function main() {
  const { out, rest } = takeOut(process.argv.slice(2));
  const env = process.env;
  const control = rest.includes('--control');
  const tenant = await applyTenantArg(rest, env);
  const label = tenant.label ?? (control ? 'control' : 'database');

  const url = control ? env.CONTROL_DATABASE_URL : env.DATABASE_URL;
  if (!url) throw new Error(`${control ? 'CONTROL_DATABASE_URL' : 'DATABASE_URL'} is not set`);
  const ca = control ? (env.CONTROL_DATABASE_CA_CERT ?? env.DATABASE_CA_CERT) : env.DATABASE_CA_CERT;
  const host = new URL(url).hostname;
  const local = isLocalHost(host);
  console.log(`Target project: ${host}`);

  const secrets = [url, decodeURIComponent(new URL(url).password), new URL(url).password];
  const show = (text: string) => redact(text, secrets);

  // The URL reaches the container only through the environment. Locally the container reaches the host DB
  // through host.docker.internal and no TLS is used (pgConfig skips it too).
  const dockerUrl = new URL(url);
  if (local) dockerUrl.hostname = 'host.docker.internal';
  const dockerEnv = { ...env, PGURL: dockerUrl.toString(), MSYS_NO_PATHCONV: '1' };
  const mounts = ['-v', `${out}:/out`];
  const tls: string[] = [];
  if (!local) {
    if (!ca) throw new Error('DATABASE_CA_CERT (or CONTROL_DATABASE_CA_CERT) is not set');
    tls.push('-e', 'PGSSLMODE=verify-full', '-e', 'PGSSLROOTCERT=/ca.crt');
    mounts.push('-v', `${path.resolve(ca)}:/ca.crt:ro`);
  }

  mkdirSync(out, { recursive: true });

  const run = (args: string[]) => {
    const r = spawnSync('docker', args, { env: dockerEnv, encoding: 'utf8' });
    if (r.error) throw new Error(show(`docker failed to start: ${r.error.message}`));
    const text = show(`${r.stdout ?? ''}${r.stderr ?? ''}`).trim();
    if (r.status !== 0) throw new Error(`docker exited ${r.status}${text ? `:\n${text}` : ''}`);
    return text;
  };

  for (const [kind, file] of [['full', 'full.dump'], ['schema', 'schema.dump']] as const) {
    const text = run(['run', '--rm', '-e', 'PGURL', ...tls, ...mounts, IMAGE, 'sh', '-c', 'pg_dump "$PGURL" "$@"', '--', ...pgDumpArgs(kind, `/out/${file}`)]);
    if (text) console.log(text);
  }

  const c = new Client(pgConfig({ DATABASE_URL: url, DATABASE_CA_CERT: ca }));
  await c.connect();
  let counts: unknown[];
  let serverVersion: string;
  let vaultNames: string[] = [];
  try {
    await c.query('begin read only');
    counts = (await c.query(countsSql())).rows.map((r) => ({ table: r.table, rows: Number(r.rows) }));
    serverVersion = (await c.query('select version() as v')).rows[0].v;
    if (control) vaultNames = (await c.query('select name from vault.secrets order by name')).rows.map((r) => r.name);
    await c.query('rollback');
  } finally {
    await c.end();
  }
  writeFileSync(path.join(out, 'counts.json'), JSON.stringify(counts, null, 2));

  const envNames = Object.keys(parse(readFileSync(resolveEnvFile(env, existsSync))));
  writeFileSync(path.join(out, 'settings.md'), settingsMarkdown({ label, host, serverVersion, envNames, vaultNames }));

  for (const f of ['full.dump', 'schema.dump', 'counts.json', 'settings.md']) console.log(`${f}  ${statSync(path.join(out, f)).size} bytes`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

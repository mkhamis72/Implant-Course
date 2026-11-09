import './load-env';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import type { SelfAuth } from '@mkhamis72/self-auth';
import { pgConfig } from './db';
import { applyTenantArg } from './tenant-env';
import { closeNodeAuth, nodeAuth, nodeConsoleAuth } from './self-auth-node';

/**
 * Switch-over helpers (docs/operations.md §E steps 2 and 3).
 *   jwks                      prints the PUBLIC key (Self-Auth's jwks()) to import into Supabase as a standby key.
 *   check [--tenant <slug>]   looks up a made-up session through Self-Auth's own connection (SELF_AUTH_DATABASE_URL
 *                             or DATABASE_URL: proves it reaches self_auth, e.g. through the session pooler), then
 *                             mints a database token and calls the read-only branding_for on the company project:
 *                             200 means Supabase accepts Self-Auth's tokens, 401 means the key isn't imported.
 *   check --control           the same on the control project, with is_console_admin (authenticated only).
 * Prints statuses only, never a token or a key's private part.
 */
const USAGE = 'Usage: npm run self-auth:keys -- jwks | check [--tenant <slug>] | check --control';

export type KeysArgs = { cmd: 'jwks' } | { cmd: 'check'; control: boolean; rest: string[] };

export function parseKeysArgs(argv: string[]): KeysArgs {
  const [cmd, ...rest] = argv;
  if (cmd === 'jwks' && rest.length === 0) return { cmd };
  if (cmd === 'check') {
    if (rest.length === 1 && rest[0] === '--control') return { cmd, control: true, rest: [] };
    if (rest.length === 0 || (rest.length === 2 && rest[0] === '--tenant' && rest[1])) return { cmd, control: false, rest };
  }
  throw new Error(USAGE);
}

/** A short-lived token for a made-up user and session: enough for PostgREST to check its signature. */
export function probeToken(auth: Pick<SelfAuth, 'issueDbToken'>, companyId: string): Promise<string> {
  return auth.issueDbToken({
    sessionId: randomUUID(), userId: '00000000-0000-0000-0000-000000000000', companyId, email: '', aal: 'aal1',
    expiresAt: new Date(Date.now() + 5 * 60_000),
  });
}

/** POSTs one RPC with the anon key and the token; returns the status line to print and whether it passed. */
export async function probe(
  o: { supabaseUrl: string; anonKey: string; rpc: string; body: unknown; token: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; line: string }> {
  const res = await fetchImpl(`${o.supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/${o.rpc}`, {
    method: 'POST',
    headers: { apikey: o.anonKey, authorization: `Bearer ${o.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(o.body),
  });
  if (res.status === 200) return { ok: true, line: `${o.rpc}: 200, Supabase accepts Self-Auth's database tokens.` };
  if (res.status === 401) {
    return { ok: false, line: `${o.rpc}: 401, the token was refused. Import the jwks output as a standby key (Project Settings -> JWT Keys) and check SELF_AUTH_KID.` };
  }
  return { ok: false, line: `${o.rpc}: unexpected status ${res.status}.` };
}

function required(env: Record<string, string | undefined>, name: string): string {
  const v = env[name]?.trim();
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

async function main() {
  const args = parseKeysArgs(process.argv.slice(2));
  if (args.cmd === 'jwks') {
    console.log(JSON.stringify((await nodeAuth()).jwks(), null, 2));
    return;
  }
  let result: { ok: boolean; line: string };
  if (args.control) {
    const token = await probeToken(await nodeConsoleAuth(), 'console');
    result = await probe({
      supabaseUrl: required(process.env, 'CONTROL_SUPABASE_URL'),
      anonKey: process.env.CONTROL_ANON_KEY?.trim() || required(process.env, 'NEXT_PUBLIC_CONTROL_ANON_KEY'),
      rpc: 'is_console_admin', body: {}, token,
    });
  } else {
    const { label } = await applyTenantArg(args.rest, process.env);
    console.log(`Target project: ${label ?? process.env.NEXT_PUBLIC_SUPABASE_URL}`);
    const slug = args.rest[1] ?? 'academy';
    const pg = new Client(pgConfig(process.env));
    await pg.connect();
    let companyId: string | undefined;
    try {
      companyId = (await pg.query<{ id: string }>('select id from public.companies where slug = $1', [slug])).rows[0]?.id;
    } finally {
      await pg.end();
    }
    if (!companyId) throw new Error(`No company with slug ${slug} in this database`);
    const auth = await nodeAuth();
    // A random token: no session, so null, but only after Self-Auth has queried its tables over its own URL.
    await auth.getSession(randomUUID(), companyId);
    console.log(`Self-Auth database: reachable over ${process.env.SELF_AUTH_DATABASE_URL ? 'SELF_AUTH_DATABASE_URL' : 'DATABASE_URL'}.`);
    const token = await probeToken(auth, companyId);
    result = await probe({
      supabaseUrl: required(process.env, 'NEXT_PUBLIC_SUPABASE_URL'), anonKey: required(process.env, 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
      rpc: 'branding_for', body: { p_company: companyId }, token,
    });
  }
  console.log(result.line);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1]?.endsWith('self-auth-keys.ts')) {
  main()
    .catch((e) => {
      console.error(e instanceof Error ? e.message : 'failed');
      process.exitCode = 1;
    })
    .finally(() => closeNodeAuth());
}

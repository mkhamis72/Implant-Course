import './load-env';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import type { SelfAuth } from '@mkhamis72/self-auth';
import { pgConfig } from './db';
import { refuseRemovedOptions, takeCompanyArg } from './one-database';
import { closeNodeAuth, nodeAuth } from './self-auth-node';

/**
 * Switch-over helpers (docs/operations.md §E).
 *   jwks                      prints the PUBLIC key (Self-Auth's jwks()) of the signing key, to compare its kid with the
 *                             standby key in Supabase. Supabase imports only the private key.
 *   check [--company <slug>]  (step 3, before Migration A) mints a database token and calls the read-only branding_for
 *                             on the project: 200 means Supabase accepts Self-Auth's tokens, 401 means the key isn't
 *                             imported. Touches no self_auth table.
 *   reach [--company <slug>]  (after the release that applies Migration A) looks up a made-up session through
 *                             Self-Auth's own connection (SELF_AUTH_DATABASE_URL, else DATABASE_URL): proves it reaches
 *                             self_auth, e.g. through the session pooler. Before Migration A: "not migrated yet".
 * Prints statuses only, never a token, a key's private part or a database URL.
 */
const USAGE = 'Usage: npm run self-auth:keys -- jwks | check [--company <slug>] | reach [--company <slug>]';

export type KeysArgs = { cmd: 'jwks' } | { cmd: 'check' | 'reach'; slug: string };

export function parseKeysArgs(argv: string[]): KeysArgs {
  const [cmd, ...rest] = refuseRemovedOptions(argv);
  if (cmd === 'jwks' && rest.length === 0) return { cmd };
  if (cmd === 'check' || cmd === 'reach') {
    let picked: { slug: string | null; rest: string[] };
    try {
      picked = takeCompanyArg(rest);
    } catch {
      throw new Error(USAGE);
    }
    if (picked.rest.length === 0) return { cmd, slug: picked.slug ?? 'academy' };
  }
  throw new Error(USAGE);
}

/** Undefined table or schema (Postgres 42P01 / 3F000), however the auth library wraps it. */
function notMigrated(e: unknown, depth = 0): boolean {
  if (depth > 3 || !e) return false;
  const code = (e as { code?: unknown }).code;
  if (code === '42P01' || code === '3F000') return true;
  if (notMigrated((e as { cause?: unknown }).cause, depth + 1)) return true;
  return e instanceof Error && /(relation|schema) .* does not exist/.test(e.message);
}

/** Self-Auth looks up a random token over its own URL: null (no such session) proves it reached its tables. */
export async function reachCheck(
  auth: { getSession(token: string, companyId: string): Promise<unknown> }, companyId: string, via: string,
): Promise<{ ok: boolean; line: string }> {
  try {
    await auth.getSession(randomUUID(), companyId);
    return { ok: true, line: `Self-Auth database: reachable over ${via}.` };
  } catch (e) {
    if (notMigrated(e)) {
      return { ok: false, line: `Self-Auth database: reachable over ${via}, but not migrated yet (no self_auth tables). Run this after the release that applies Migration A.` };
    }
    const code = (e as { code?: unknown } | null)?.code;
    const reason = typeof code === 'string' && code ? code : e instanceof Error ? e.name : 'failed';
    return { ok: false, line: `Self-Auth database: unreachable over ${via} (${reason}).` };
  }
}

/** The company's id in the one database ENV_FILE points at. */
async function companyIdFor(slug: string): Promise<string> {
  console.log(`Target project: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
  const pg = new Client(pgConfig(process.env));
  await pg.connect();
  try {
    const id = (await pg.query<{ id: string }>('select id from public.companies where slug = $1', [slug])).rows[0]?.id;
    if (!id) throw new Error(`No company with slug ${slug} in this database`);
    return id;
  } finally {
    await pg.end();
  }
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
    return { ok: false, line: `${o.rpc}: 401, the token was refused. Import that project's private signing key as a standby key (Project Settings -> JWT Keys) and check its kid (SELF_AUTH_KID).` };
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
  if (args.cmd === 'reach') {
    const companyId = await companyIdFor(args.slug);
    result = await reachCheck(await nodeAuth(), companyId, process.env.SELF_AUTH_DATABASE_URL ? 'SELF_AUTH_DATABASE_URL' : 'DATABASE_URL');
  } else {
    // Before Migration A: only a signed token, no self_auth table is touched.
    const companyId = await companyIdFor(args.slug);
    const token = await probeToken(await nodeAuth(), companyId);
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

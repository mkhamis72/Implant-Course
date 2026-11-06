import './load-env';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { pgConfig } from './db';

/** The company that existed before the shared database: the one a canary company must never see. */
export const ACADEMY_ID = 'a7c0de00-0000-4000-8000-000000000001';

/** What one table gave the canary session when asked for academy's rows. */
export type TableResult = {
  table: string;
  /** Rows of academy visible to the session (count with a company_id filter); null if the query failed. */
  academyRows: number | null;
  /** PostgREST error code, when the query failed. 42501 (permission denied) means the table is closed to the session. */
  errorCode?: string;
  errorMessage?: string;
};

export type CanaryReport = { ok: boolean; lines: string[]; problems: string[] };

/**
 * Pure: pass only if every table gave 0 academy rows. A closed table (42501) shows nothing, which is fine; any other
 * failure is a problem, because a query that did not run proves nothing. The canary's own settings row must be
 * visible (ownSettingsRows >= 1), otherwise the session is not bound to the canary and every 0 above is empty praise.
 * No tables at all fails too: an empty list proves nothing either.
 */
export function evaluateCanary(results: TableResult[], ownSettingsRows: number | null): CanaryReport {
  const problems: string[] = [];
  const lines: string[] = [];
  if (!results.length) problems.push('no company tables were checked');
  for (const r of [...results].sort((a, b) => a.table.localeCompare(b.table))) {
    if (r.academyRows === null) {
      if (r.errorCode === '42501') {
        lines.push(`${r.table}: closed to the session (permission denied)`);
      } else {
        lines.push(`${r.table}: ERROR ${r.errorCode ?? ''} ${r.errorMessage ?? ''}`.trimEnd());
        problems.push(`${r.table}: the query failed (${r.errorCode ?? 'no code'}${r.errorMessage ? `: ${r.errorMessage}` : ''})`);
      }
    } else {
      lines.push(`${r.table}: ${r.academyRows} academy rows`);
      if (r.academyRows !== 0) problems.push(`${r.table}: ${r.academyRows} academy rows visible to the canary session`);
    }
  }
  if (ownSettingsRows === null || ownSettingsRows < 1) {
    problems.push("the canary's own settings row is not visible: the session is not bound to the canary company");
  }
  return { ok: problems.length === 0, lines, problems };
}

type Env = Record<string, string | undefined>;

/** The inputs the owner supplies through the environment (never as logged output). */
export function canaryInputs(env: Env): { url: string; anonKey: string; email: string; password: string; totp?: string; companyId: string } {
  const need = (name: string) => {
    const v = env[name];
    if (!v) throw new Error(`${name} is not set`);
    return v;
  };
  return {
    url: need('NEXT_PUBLIC_SUPABASE_URL'),
    anonKey: need('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    email: need('CANARY_EMAIL'),
    password: need('CANARY_PASSWORD'),
    totp: env.CANARY_TOTP || undefined,
    companyId: need('CANARY_COMPANY_ID'),
  };
}

/**
 * Pure: the project the PostgREST session talks to (NEXT_PUBLIC_SUPABASE_URL) and the one the table list is read from
 * (DATABASE_URL) must be the same. Supabase hosts are `db.<ref>.supabase.co` / `<ref>.supabase.co`, the session pooler's user
 * is `postgres.<ref>`, a local stack is the same host on both. Returns an error text, or null when they match.
 */
export function projectMismatch(supabaseUrl: string, databaseUrl: string): string | null {
  const api = new URL(supabaseUrl);
  const db = new URL(databaseUrl);
  const ref = (host: string) => host.match(/^(?:db\.)?([a-z0-9]+)\.supabase\.co$/)?.[1];
  const apiRef = ref(api.hostname);
  const dbRef = ref(db.hostname) ?? decodeURIComponent(db.username).split('.')[1];
  const same = apiRef || dbRef ? apiRef === dbRef : api.hostname === db.hostname;
  return same ? null : `NEXT_PUBLIC_SUPABASE_URL (${api.hostname}) and DATABASE_URL (${db.hostname}) are different projects`;
}

/** The tables the canary could read through PostgREST: company tables in public, from the catalog (read only). */
async function companyTables(env: Env): Promise<string[]> {
  const c = new Client(pgConfig(env));
  await c.connect();
  try {
    await c.query('begin read only');
    const { rows } = await c.query(
      `select c.relname as name from app.company_tables() t join pg_class c on c.oid = t
       where c.relnamespace = 'public'::regnamespace order by 1`,
    );
    await c.query('rollback');
    return rows.map((r) => r.name as string);
  } finally {
    await c.end();
  }
}

async function main() {
  const input = canaryInputs(process.env);
  console.log(`Target project: ${new URL(input.url).hostname}`);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  console.log(`Table list from: ${new URL(databaseUrl).hostname}`);
  const mismatch = projectMismatch(input.url, databaseUrl);
  if (mismatch) throw new Error(mismatch);
  if (input.companyId === ACADEMY_ID) throw new Error('CANARY_COMPANY_ID is the academy: the check needs the canary company');
  const tables = await companyTables(process.env);

  const supabase = createClient(input.url, input.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signedIn = await supabase.auth.signInWithPassword({ email: input.email, password: input.password });
  if (signedIn.error) throw new Error(`Sign-in failed: ${signedIn.error.message}`);
  const factors = await supabase.auth.mfa.listFactors();
  const totp = factors.data?.totp.find((f) => f.status === 'verified');
  if (totp) {
    if (!input.totp) throw new Error('The canary user has 2FA: set CANARY_TOTP to the current code');
    const verified = await supabase.auth.mfa.challengeAndVerify({ factorId: totp.id, code: input.totp });
    if (verified.error) throw new Error(`2FA failed: ${verified.error.message}`);
  }
  const bound = await supabase.rpc('bind_my_session', { p_company: input.companyId });
  if (bound.error) throw new Error(`Could not bind the session to the canary company: ${bound.error.message}`);

  const results: TableResult[] = [];
  for (const table of tables) {
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true }).eq('company_id', ACADEMY_ID);
    results.push(error ? { table, academyRows: null, errorCode: error.code, errorMessage: error.message } : { table, academyRows: count ?? 0 });
  }
  const own = await supabase.from('settings').select('*', { count: 'exact', head: true }).eq('company_id', input.companyId);
  const report = evaluateCanary(results, own.error ? null : (own.count ?? 0));
  for (const l of report.lines) console.log(l);
  for (const p of report.problems) console.log(`PROBLEM ${p}`);
  console.log(report.ok ? 'PASS' : 'FAIL');
  await supabase.auth.signOut({ scope: 'local' });
  process.exitCode = report.ok ? 0 : 1;
}

if (process.argv[1] && /canary-check\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

import './load-env';
import { createClient } from '@supabase/supabase-js';
import { targetLabel } from './create-user-args';
import { closeNodeAuth, nodeAuth, nodeConsoleAuth } from './self-auth-node';
import { listSource } from '../src/lib/tenant/source';
import { temporaryPassword } from '../src/lib/admin/passwords';

const CONSOLE_COMPANY = 'console';

export function parseConsoleAdminArgs(argv: string[]): { email: string } {
  const email = (argv[0] ?? '').trim().toLowerCase();
  if (argv.length !== 1 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Usage: npm run console:admin -- <email>');
  return { email };
}

export type ConsoleAdminTarget = { source: 'control' | 'production'; url: string; key: string; table: 'console_admins' | 'console_users' };

/** Where the console admin list lives: production (COMPANY_LIST=production) or the control project. */
export function consoleAdminTarget(env: Record<string, string | undefined> = process.env): ConsoleAdminTarget {
  if (listSource(env) === 'production') {
    const url = env.NEXT_PUBLIC_SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing: add the service key to the env file for this command, then remove it.');
    return { source: 'production', url, key, table: 'console_users' };
  }
  const url = env.CONTROL_SUPABASE_URL;
  const key = env.CONTROL_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('CONTROL_SUPABASE_URL / CONTROL_SERVICE_ROLE_KEY missing: add the service key to the env file for this command, then remove it.');
  return { source: 'control', url, key, table: 'console_admins' };
}

/**
 * Creates (or resets) a console admin: a Self-Auth account of company 'console' in the control database
 * (CONTROL_DATABASE_URL, CONTROL_SELF_AUTH_SECRET, and CONTROL_SELF_AUTH_PRIVATE_JWK + CONTROL_SELF_AUTH_KID or else
 * SELF_AUTH_PRIVATE_JWK + SELF_AUTH_KID) and its console_admins row
 * through the control project's API (CONTROL_SUPABASE_URL, CONTROL_SERVICE_ROLE_KEY).
 * With COMPANY_LIST=production: the company Self-Auth (DATABASE_URL, SELF_AUTH_SECRET, SELF_AUTH_PRIVATE_JWK,
 * SELF_AUTH_KID) and console_users through the company project (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
 */
async function main() {
  const { email } = parseConsoleAdminArgs(process.argv.slice(2));
  const target = consoleAdminTarget();
  console.log(`Target project: ${targetLabel(target.url)} (${target.source})`);
  const db = createClient(target.url, target.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const auth = await (target.source === 'production' ? nodeAuth() : nodeConsoleAuth());
  const password = temporaryPassword();
  const existing = (await auth.admin.listUsers(CONSOLE_COMPANY)).find((u) => u.email.toLowerCase() === email);
  let userId: string;
  if (existing) {
    // Ends their sessions and clears any sign-in lockout; the authenticator stays.
    await auth.admin.setPassword(CONSOLE_COMPANY, existing.userId, password);
    if (existing.disabled) await auth.admin.setDisabled(CONSOLE_COMPANY, existing.userId, false);
    userId = existing.userId;
  } else {
    userId = (await auth.admin.createUser({ companyId: CONSOLE_COMPANY, email, password })).userId;
  }
  const { error } = await db.from(target.table).upsert({ user_id: userId, email, active: true });
  if (error) throw new Error(`Could not list ${email} as a console admin: ${error.message}`);
  console.log(`Console admin ready: ${email}`);
  console.log(`Temporary password: ${password}`);
  console.log('Sign in on the console address; set up 2FA at first sign-in (an existing authenticator is kept).');
}

if (process.argv[1]?.endsWith('console-admin.ts')) {
  main()
    .catch((e) => {
      console.error(e instanceof Error ? e.message : 'failed');
      process.exitCode = 1;
    })
    .finally(() => closeNodeAuth());
}

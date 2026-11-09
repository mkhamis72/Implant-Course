import './load-env';
import { createClient } from '@supabase/supabase-js';
import { targetLabel } from './create-user-args';
import { closeNodeAuth, nodeConsoleAuth } from './self-auth-node';
import { temporaryPassword } from '../src/lib/admin/passwords';

const CONSOLE_COMPANY = 'console';

export function parseConsoleAdminArgs(argv: string[]): { email: string } {
  const email = (argv[0] ?? '').trim().toLowerCase();
  if (argv.length !== 1 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Usage: npm run console:admin -- <email>');
  return { email };
}

/**
 * Creates (or resets) a console admin: a Self-Auth account of company 'console' in the control database
 * (CONTROL_DATABASE_URL, CONTROL_SELF_AUTH_SECRET, SELF_AUTH_PRIVATE_JWK, SELF_AUTH_KID) and its console_admins row
 * through the control project's API (CONTROL_SUPABASE_URL, CONTROL_SERVICE_ROLE_KEY).
 */
async function main() {
  const { email } = parseConsoleAdminArgs(process.argv.slice(2));
  console.log(`Target project: control ${process.env.CONTROL_SUPABASE_URL ? targetLabel(process.env.CONTROL_SUPABASE_URL) : '(CONTROL_SUPABASE_URL not set)'}`);
  const url = process.env.CONTROL_SUPABASE_URL;
  const key = process.env.CONTROL_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('CONTROL_SUPABASE_URL / CONTROL_SERVICE_ROLE_KEY missing: add the service key to the env file for this command, then remove it.');
  const control = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const auth = await nodeConsoleAuth();
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
  const { error } = await control.from('console_admins').upsert({ user_id: userId, email, active: true });
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

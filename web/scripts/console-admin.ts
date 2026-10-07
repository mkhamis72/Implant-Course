import './load-env';
import { createClient } from '@supabase/supabase-js';
import { ensureUser } from './users';
import { targetLabel } from './create-user-args';
import { temporaryPassword } from '../src/lib/admin/passwords';

export function parseConsoleAdminArgs(argv: string[]): { email: string } {
  const email = (argv[0] ?? '').trim().toLowerCase();
  if (argv.length !== 1 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Usage: npm run console:admin -- <email>');
  return { email };
}

/** Creates (or resets) a console admin in the control project; needs CONTROL_SUPABASE_URL and CONTROL_SERVICE_ROLE_KEY. */
async function main() {
  const { email } = parseConsoleAdminArgs(process.argv.slice(2));
  console.log(`Target project: control ${process.env.CONTROL_SUPABASE_URL ? targetLabel(process.env.CONTROL_SUPABASE_URL) : '(CONTROL_SUPABASE_URL not set)'}`);
  const url = process.env.CONTROL_SUPABASE_URL;
  const key = process.env.CONTROL_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('CONTROL_SUPABASE_URL / CONTROL_SERVICE_ROLE_KEY missing: add the service key to the env file for this command, then remove it.');
  const control = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const password = temporaryPassword();
  const userId = await ensureUser(control, { email, password });
  const { error } = await control.from('console_admins').upsert({ user_id: userId, email, active: true });
  if (error) throw new Error(`Could not list ${email} as a console admin: ${error.message}`);
  console.log(`Console admin ready: ${email}`);
  console.log(`Temporary password: ${password}`);
  console.log('Sign in on the console address; set up 2FA at first sign-in (an existing authenticator is kept).');
}

if (process.argv[1]?.endsWith('console-admin.ts')) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

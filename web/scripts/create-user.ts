import './load-env';
import { Client } from 'pg';
import { pgConfig } from './db';
import { adminClient, ensureUser, setProfile } from './users';
import { temporaryPassword } from '../src/lib/admin/passwords';
import { parseCreateUserArgs, targetLabel } from './create-user-args';
import { applyTenantArg } from './tenant-env';

async function main() {
  const { argv, label } = await applyTenantArg(process.argv.slice(2), process.env);
  const args = parseCreateUserArgs(argv);
  if ('error' in args) {
    console.error(args.error);
    process.exit(1);
  }
  console.log(`Target project: ${label ?? targetLabel(process.env.NEXT_PUBLIC_SUPABASE_URL)}`);
  const password = temporaryPassword();
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    const userId = await ensureUser(adminClient(), { email: args.email, password, pending: { pg } });
    await setProfile(pg, userId, { full_name: args.fullName, role: args.role, active: true, delegate_id: args.delegateId ?? null });
  } finally {
    await pg.end();
  }
  console.log(`${{ admin: 'Admin', organizer: 'Organizer', delegate: 'Delegate login' }[args.role]} ready: ${args.email}`);
  console.log(`Temporary password: ${password}`);
  console.log('Hand it over in person. They sign in, then change it under Account security → Change password.');
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});

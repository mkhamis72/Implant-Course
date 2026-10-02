import './load-env';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { pgConfig } from './db';
import { adminClient, ensureUser, setProfile } from './users';
import { parseCreateUserArgs, targetLabel } from './create-user-args';

async function main() {
  const args = parseCreateUserArgs(process.argv.slice(2));
  if ('error' in args) {
    console.error(args.error);
    process.exit(1);
  }
  console.log(`Target project: ${targetLabel(process.env.NEXT_PUBLIC_SUPABASE_URL)}`);
  const password = randomBytes(12).toString('base64url');
  const userId = await ensureUser(adminClient(), { email: args.email, password });
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    await setProfile(pg, userId, { full_name: args.fullName, role: args.role, active: true });
  } finally {
    await pg.end();
  }
  console.log(`${args.role === 'admin' ? 'Admin' : 'Organizer'} ready: ${args.email}`);
  console.log(`Temporary password: ${password}`);
  console.log('Hand it over in person. They sign in, then change it under Account security → Change password.');
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});

import './load-env';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { pgConfig } from './db';
import { adminClient, ensureUser, setProfile } from './users';

async function main() {
  const [email, ...nameParts] = process.argv.slice(2);
  if (!email || nameParts.length === 0) {
    console.error('Usage: npm run create-admin -- <email> "<Full Name>"');
    process.exit(1);
  }
  const password = randomBytes(12).toString('base64url');
  const userId = await ensureUser(adminClient(), { email, password });
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    await setProfile(pg, userId, { full_name: nameParts.join(' '), role: 'admin', active: true });
  } finally {
    await pg.end();
  }
  console.log(`Admin ready: ${email.trim().toLowerCase()}`);
  console.log(`Temporary password: ${password}`);
  console.log('Sign in, then change it under Account security → Change password.');
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});

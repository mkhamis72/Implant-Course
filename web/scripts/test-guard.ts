type Env = Record<string, string | undefined>;

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];

/** True for a local Supabase stack (`supabase start`): nothing on it is hosted or shared. */
export function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.includes(hostname);
}

/**
 * Test fixtures create a known-password admin and write to the audit log, so they may only
 * run against the local Supabase stack (TEST_SUPABASE_PROJECT_REF=local) or an explicitly
 * allow-listed hosted dev project — never one copied from production.
 */
export function assertSafeTestTarget(env: Env = process.env): void {
  if (env.ALLOW_TEST_FIXTURES !== '1') {
    throw new Error('Refusing to create test fixtures: set ALLOW_TEST_FIXTURES=1 in .env.local (dev project only).');
  }
  const ref = env.TEST_SUPABASE_PROJECT_REF;
  if (!ref) throw new Error('Refusing to create test fixtures: TEST_SUPABASE_PROJECT_REF is not set.');
  if (!env.TEST_USER_PASSWORD) throw new Error('Refusing to create test fixtures: TEST_USER_PASSWORD is not set.');

  const apiHost = env.NEXT_PUBLIC_SUPABASE_URL ? new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname : '';
  const db = env.DATABASE_URL ? new URL(env.DATABASE_URL) : null;
  const matches =
    ref === 'local'
      ? isLocalHost(apiHost) && !!db && isLocalHost(db.hostname)
      : apiHost === `${ref}.supabase.co` &&
        !!db &&
        (db.username === `postgres.${ref}` || db.hostname === `db.${ref}.supabase.co`);
  if (!matches) {
    throw new Error(`Refusing to create test fixtures: the configured project is not the allow-listed test project (${ref}).`);
  }
}

import { Client } from 'pg';
import { pgConfig } from '../../scripts/db';
import { adminClient, ensureUser, setProfile } from '../../scripts/users';

export const TEST_PASSWORD = process.env.TEST_USER_PASSWORD ?? 'Test-password-123!';

export const TEST_USERS = {
  admin: { email: 'icm-test-admin@example.com' },
  organizer: { email: 'icm-test-organizer@example.com' },
  inactive: { email: 'icm-test-inactive@example.com' },
  unverified: { email: 'icm-test-unverified@example.com' },
  mfa: { email: 'icm-test-mfa@example.com' },
  target: { email: 'icm-test-target@example.com' },
} as const;

export type TestUserKey = keyof typeof TEST_USERS;
export type TestUserIds = Record<TestUserKey, string>;

const PROFILES: Record<TestUserKey, { full_name: string; role: 'admin' | 'organizer'; active: boolean }> = {
  admin: { full_name: 'Test Admin', role: 'admin', active: true },
  organizer: { full_name: 'Test Organizer', role: 'organizer', active: true },
  inactive: { full_name: 'Test Inactive', role: 'organizer', active: false },
  unverified: { full_name: 'Test Unverified', role: 'organizer', active: true },
  mfa: { full_name: 'Test Mfa', role: 'organizer', active: true },
  target: { full_name: 'Test Target', role: 'organizer', active: true },
};

/** Idempotently creates the test users and resets their profiles, bans and 2FA factors. */
export async function ensureTestUsers(): Promise<TestUserIds> {
  const admin = adminClient();
  const ids = {} as TestUserIds;
  for (const key of Object.keys(TEST_USERS) as TestUserKey[]) {
    ids[key] = await ensureUser(admin, {
      email: TEST_USERS[key].email,
      password: TEST_PASSWORD,
      emailConfirm: key !== 'unverified',
    });
  }
  const { data: factors, error } = await admin.auth.admin.mfa.listFactors({ userId: ids.mfa });
  if (error) throw error;
  for (const factor of factors.factors) {
    await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: ids.mfa });
  }
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    // Profiles table exists only after migration 0001; skip silently before that.
    const { rows } = await pg.query("select to_regclass('public.profiles') as t");
    if (rows[0].t) {
      for (const key of Object.keys(PROFILES) as TestUserKey[]) {
        await setProfile(pg, ids[key], PROFILES[key]);
      }
    }
  } finally {
    await pg.end();
  }
  return ids;
}

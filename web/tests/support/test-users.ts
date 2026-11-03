import { Client } from 'pg';
import { pgConfig } from '../../scripts/db';
import { adminClient, ensureUser, setPermissions, setProfile } from '../../scripts/users';
import { assertSafeTestTarget } from '../../scripts/test-guard';

// No default: a password committed to the repo would be a known admin login. See assertSafeTestTarget.
export const TEST_PASSWORD = process.env.TEST_USER_PASSWORD ?? '';

export const TEST_USERS = {
  admin: { email: 'icm-test-admin@example.com' },
  organizer: { email: 'icm-test-organizer@example.com' },
  inactive: { email: 'icm-test-inactive@example.com' },
  unverified: { email: 'icm-test-unverified@example.com' },
  mfa: { email: 'icm-test-mfa@example.com' },
  target: { email: 'icm-test-target@example.com' },
  viewer: { email: 'icm-test-viewer@example.com' },
  delegate: { email: 'icm-test-delegate@example.com' },
} as const;

export type TestUserKey = keyof typeof TEST_USERS;
export type TestUserIds = Record<TestUserKey, string>;

const PROFILES: Record<TestUserKey, { full_name: string; role: 'admin' | 'organizer' | 'delegate'; active: boolean }> = {
  admin: { full_name: 'Test Admin', role: 'admin', active: true },
  organizer: { full_name: 'Test Organizer', role: 'organizer', active: true },
  inactive: { full_name: 'Test Inactive', role: 'organizer', active: false },
  unverified: { full_name: 'Test Unverified', role: 'organizer', active: true },
  mfa: { full_name: 'Test Mfa', role: 'organizer', active: true },
  target: { full_name: 'Test Target', role: 'organizer', active: true },
  viewer: { full_name: 'Test Viewer', role: 'organizer', active: true },
  delegate: { full_name: 'Test Delegate Login', role: 'delegate', active: true },
};

const ALL_EDIT = { patients: 'edit', schedule: 'edit', courses: 'edit', checklists: 'edit', inventory: 'edit', delegates: 'edit' } as const;
/** View everywhere, Edit on Inventory: the E2E view-only organizer. */
const VIEWER = { patients: 'view', schedule: 'view', courses: 'view', checklists: 'view', inventory: 'edit', delegates: 'view' } as const;
export const TEST_DELEGATE_NAME = 'Test Delegate Login';

/** Idempotently creates the test users and resets their profiles, bans and 2FA factors. */
export async function ensureTestUsers(): Promise<TestUserIds> {
  assertSafeTestTarget();
  const admin = adminClient();
  const ids = {} as TestUserIds;
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    // Both global setups migrate first, so the schema is current: no per-migration guards.
    // A new account needs a pending login (0090).
    for (const key of Object.keys(TEST_USERS) as TestUserKey[]) {
      ids[key] = await ensureUser(admin, {
        email: TEST_USERS[key].email,
        password: TEST_PASSWORD,
        emailConfirm: key !== 'unverified',
        pending: { pg },
      });
    }
    const { data: factors, error } = await admin.auth.admin.mfa.listFactors({ userId: ids.mfa });
    if (error) throw error;
    for (const factor of factors.factors) {
      await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: ids.mfa });
    }
    for (const key of Object.keys(PROFILES) as TestUserKey[]) {
      const profile = PROFILES[key];
      if (profile.role !== 'delegate') {
        await setProfile(pg, ids[key], profile);
        continue;
      }
      const existing = await pg.query('select id from public.delegates where full_name = $1 order by created_at limit 1', [TEST_DELEGATE_NAME]);
      const delegateId = existing.rows[0]?.id
        ?? (await pg.query('insert into public.delegates (full_name, email) values ($1, $2) returning id', [TEST_DELEGATE_NAME, TEST_USERS.delegate.email])).rows[0].id;
      await pg.query('update public.delegates set active = true where id = $1', [delegateId]);
      await setProfile(pg, ids[key], { ...profile, delegate_id: delegateId });
    }
    // Pin permissions so a re-created organizer isn't left with the View-only default.
    for (const key of Object.keys(PROFILES) as TestUserKey[]) {
      if (PROFILES[key].role === 'organizer') await setPermissions(pg, ids[key], key === 'viewer' ? VIEWER : ALL_EDIT);
    }
    // Each staff test user supervises under its own id.
    for (const key of Object.keys(PROFILES) as TestUserKey[]) {
      if (PROFILES[key].role === 'delegate') continue;
      await pg.query(
        `insert into public.supervisors (id, full_name, active) values ($1, $2, $3)
         on conflict (id) do update set full_name = excluded.full_name, active = excluded.active`,
        [ids[key], PROFILES[key].full_name, PROFILES[key].active],
      );
    }
  } finally {
    await pg.end();
  }
  return ids;
}

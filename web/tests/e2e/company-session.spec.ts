import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { Client } from 'pg';
import { pgConfig } from '../../scripts/db';
import { adminClient, setProfile } from '../../scripts/users';
import { TEST_PASSWORD, TEST_USERS } from '../support/test-users';

// Runs only with a registry of two companies on the same local stack (a.localhost = academy, b.localhost = company B):
// TENANTS_FILE=<file> npx playwright test company-session --project=chromium
const file = process.env.TENANTS_FILE;
type Entry = { slug: string; hosts: string[]; companyId?: string };
const tenants: Entry[] = file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
const companyB = tenants.find((t) => t.hosts.includes('b.localhost'))?.companyId;
test.skip(!tenants.some((t) => t.hosts.includes('a.localhost')) || !companyB, 'needs TENANTS_FILE with a.localhost and b.localhost on one stack');

const A = 'http://a.localhost:3000';
const B = 'http://b.localhost:3000';
const ACADEMY = 'a7c0de00-0000-4000-8000-000000000001';
const REFUSED = 'You do not have access to this company.';

async function withPg<T>(fn: (pg: Client) => Promise<T>): Promise<T> {
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    return await fn(pg);
  } finally {
    await pg.end();
  }
}

async function signIn(page: Page, email: string) {
  await page.goto(`${A}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}

/** The sign-in session id from the auth cookie (possibly chunked; "base64-" + JSON with the access token). */
async function sessionId(context: BrowserContext): Promise<string> {
  const parts = (await context.cookies(A))
    .filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
    .sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }));
  const raw = parts.map((c) => c.value).join('');
  const json = raw.startsWith('base64-') ? Buffer.from(raw.slice(7), 'base64url').toString('utf8') : decodeURIComponent(raw);
  const token = (JSON.parse(json) as { access_token: string }).access_token;
  return (JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { session_id: string }).session_id;
}

test.describe('the session belongs to the company it signed in on', () => {
  let userId = '';
  const email = `icm-company-session-${Date.now()}@example.com`;

  test.beforeAll(async () => {
    const { data, error } = await adminClient().auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true });
    if (error) throw error;
    userId = data.user!.id;
    await withPg(async (pg) => {
      await pg.query(`insert into public.companies (id, slug, name) values ($1, 'e2e-company-b', 'E2E Company B') on conflict (id) do nothing`, [companyB]);
      // The organizer test user is a member of academy only.
      await pg.query(
        `delete from public.company_members where company_id = $1 and user_id = (select id from auth.users where email = $2)`,
        [companyB, TEST_USERS.organizer.email],
      );
      // Mirrored into academy's member row (0085).
      await setProfile(pg, userId, { full_name: 'E2E Company Session', role: 'organizer', active: true });
    });
  });

  test.afterAll(async () => {
    if (userId) await adminClient().auth.admin.deleteUser(userId);
    // Company B exists only for this spec (DB tests expect academy to be the only company).
    await withPg((pg) => pg.query('delete from public.companies where id = $1', [companyB]));
  });

  test("academy's cookies on company B's host are refused, and that session ends", async ({ page, context }) => {
    await signIn(page, TEST_USERS.organizer.email);
    const cookies = await context.cookies(A);
    await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: B })));
    await page.goto(`${B}/`);
    await expect(page).toHaveURL(/\/login\?error=company$/);
    await expect(page.getByRole('alert').filter({ hasText: REFUSED })).toBeVisible();
    // Ended for academy too: the same cookies no longer sign anyone in there.
    await page.goto(`${A}/`);
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a session that lost its binding is bound again on its next request', async ({ page, context }) => {
    await signIn(page, email);
    const session = await sessionId(context);
    const deleted = await withPg((pg) =>
      pg.query('delete from app.session_companies where session_id = $1 and company_id = $2', [session, ACADEMY]),
    );
    expect(deleted.rowCount).toBe(1);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    const back = await withPg((pg) => pg.query('select company_id from app.session_companies where session_id = $1', [session]));
    expect(back.rows).toEqual([{ company_id: ACADEMY }]);
  });

  test('a member deactivated in the company sees "Account deactivated" on the next request', async ({ page }) => {
    await signIn(page, email);
    await withPg((pg) => pg.query('update public.company_members set active = false where company_id = $1 and user_id = $2', [ACADEMY, userId]));
    await page.reload();
    await expect(page).toHaveURL(/\/deactivated$/);
    await expect(page.getByRole('heading', { name: 'Account deactivated' })).toBeVisible();
  });

  test('a session that is unbound and no longer a member is signed out with the reason', async ({ page, context }) => {
    await withPg((pg) => pg.query('update public.company_members set active = true where company_id = $1 and user_id = $2', [ACADEMY, userId]));
    await signIn(page, email);
    const session = await sessionId(context);
    await withPg(async (pg) => {
      await pg.query('delete from public.company_members where company_id = $1 and user_id = $2', [ACADEMY, userId]);
      await pg.query('delete from app.session_companies where session_id = $1', [session]);
    });
    await page.reload();
    await expect(page).toHaveURL(/\/login\?error=company$/);
    await expect(page.getByRole('alert').filter({ hasText: REFUSED })).toBeVisible();
    // The session is gone: the next visit is a plain sign-in, not the refusal again.
    await page.goto(`${A}/`);
    await expect(page).toHaveURL(/\/login$/);
  });
});

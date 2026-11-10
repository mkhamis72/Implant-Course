import { test, expect, type BrowserContext } from '@playwright/test';
import { ensureTenantUser, setProfile } from '../../scripts/users';
import { nodeAuth } from '../../scripts/self-auth-node';
import { TEST_PASSWORD, TEST_USERS } from '../support/test-users';
import { A, ACADEMY, B, companyB, purgeCompany, REFUSED, signIn, SKIP_REASON, withPg } from './companies';

// Runs only with a registry of two companies on the same local stack (a.localhost = academy, b.localhost = company B):
// TENANTS_FILE=<file> npx playwright test company-session --project=chromium
test.skip(!companyB, SKIP_REASON);

/** The Self-Auth session id behind the host's session cookie (the id the company binding is keyed on). */
async function sessionId(context: BrowserContext): Promise<string> {
  const token = (await context.cookies(A)).find((c) => c.name === 'icm_session')?.value;
  if (!token) throw new Error('no session cookie');
  const session = await (await nodeAuth()).getSession(decodeURIComponent(token), ACADEMY);
  if (!session) throw new Error('the session cookie is not a live academy session');
  return session.sessionId;
}

test.describe('the session belongs to the company it signed in on', () => {
  let userId = '';
  const email = `icm-company-session-${Date.now()}@example.com`;

  test.beforeAll(async () => {
    await withPg(async (pg) => {
      userId = await ensureTenantUser({ email, password: TEST_PASSWORD, pending: { pg } });
      await pg.query(`insert into public.companies (id, slug, name) values ($1, 'e2e-company-b', 'E2E Company B') on conflict (id) do nothing`, [companyB]);
      // The organizer test user is a member of academy only.
      await pg.query(
        `delete from public.company_members where company_id = $1 and user_id = (select user_id from public.profiles where email = $2)`,
        [companyB, TEST_USERS.organizer.email],
      );
      await setProfile(pg, userId, { full_name: 'E2E Company Session', role: 'organizer', active: true });
    });
  });

  test.afterAll(async () => {
    if (userId) await (await nodeAuth()).admin.deleteUser(ACADEMY, userId).catch(() => {});
    // Company B exists only for this spec (DB tests expect academy to be the only company).
    await purgeCompany(companyB!);
  });

  test("academy's cookie on company B's host is treated as signed out", async ({ page, context }) => {
    await signIn(page, TEST_USERS.organizer.email);
    const cookies = await context.cookies(A);
    await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: B })));
    await page.goto(`${B}/`);
    await expect(page).toHaveURL(`${B}/login`);
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toHaveCount(0);
    // Company B's host only ignores the cookie: academy's own session is unaffected.
    await page.goto(`${A}/`);
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
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

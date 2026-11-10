import { test, expect } from '@playwright/test';
import { authenticator } from 'otplib';
import { TEST_USERS } from '../support/test-users';
import { nodeAuth } from '../../scripts/self-auth-node';
import { login } from './helpers';
import { A, B, ACADEMY, SKIP_REASON, companyB, signInThroughApi, withPg } from './companies';

// The server session layer: the Self-Auth cookie, the middleware and the per-request database token. These
// sign in through the API (not the login form), so they don't wait for the login action.
const HOME = 'http://localhost:3000';

test('anonymous: /login shows the page and branding without a cookie', async ({ request }) => {
  const res = await request.get('/login');
  expect(res.status()).toBe(200);
  expect(res.headers()['set-cookie'] ?? '').not.toContain('icm_session=');
  const logo = await request.get('/brand/logo');
  expect(logo.status()).not.toBe(307); // public path: never bounced to /login
});

test('a protected page without a cookie goes to /login', async ({ request }) => {
  const res = await request.get('/', { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(new URL(res.headers()['location'] ?? 'MISSING', HOME).pathname).toBe('/login');
});

test('a garbage cookie is cleared and sent to /login', async ({ request }) => {
  const res = await request.get('/', { maxRedirects: 0, headers: { cookie: 'icm_session=not-a-session' } });
  expect(res.status()).toBe(307);
  expect(new URL(res.headers()['location'] ?? 'MISSING', HOME).pathname).toBe('/login');
  expect(res.headers()['set-cookie']).toMatch(/icm_session=;/);
});

test('a Self-Auth session opens the dashboard, and /auth/signout ends it', async ({ page, context }) => {
  await signInThroughApi(context, TEST_USERS.organizer.email, ACADEMY, HOME);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  const out = await page.request.post('/auth/signout');
  expect(out.status()).toBe(204);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});

test('an idle session is ended by the server', async ({ page, context }) => {
  await signInThroughApi(context, TEST_USERS.organizer.email, ACADEMY, HOME);
  await context.addCookies([{ name: 'icm_last_seen', value: String(Date.now() - 2 * 60 * 60 * 1000), url: HOME }]);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login\?reason=idle$/);
  // The Self-Auth session itself is gone, not just the cookie: replaying the old cookie value gets nothing.
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});

test('session_cookie_is_company_bound: company A\'s cookie on company B\'s host is signed out', async ({ page, context }) => {
  test.skip(!companyB, SKIP_REASON);
  await signInThroughApi(context, TEST_USERS.organizer.email, ACADEMY, A);
  const cookie = (await context.cookies(A)).find((c) => c.name === 'icm_session')!;
  await context.addCookies([{ name: 'icm_session', value: cookie.value, url: B, httpOnly: true, sameSite: 'Lax' }]);
  await page.goto(`${B}/`);
  await expect(page).toHaveURL(`${B}/login`);
  expect((await context.cookies(B)).find((c) => c.name === 'icm_session')).toBeUndefined();
  // A's own session is untouched.
  await page.goto(`${A}/`);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
});

test('aal1_with_factor_goes_to_mfa: password-only sign-in of a 2FA user lands on /login/mfa', async ({ page }) => {
  const email = TEST_USERS.mfa.email;
  const auth = await nodeAuth();
  const first = await auth.signIn({ companyId: ACADEMY, email, password: process.env.TEST_USER_PASSWORD ?? '' });
  if (!first.ok) throw new Error('sign-in failed');
  const { secret } = await auth.totp.startEnroll(first.sessionToken, ACADEMY);
  expect(await auth.totp.confirmEnroll(first.sessionToken, ACADEMY, authenticator.generate(secret))).not.toBeNull();
  await auth.signOut(first.sessionToken);
  try {
    await login(page, email);
    await expect(page).toHaveURL(/\/login\/mfa$/);
    // Every other page still sends it back to the code page.
    await page.goto('/patients');
    await expect(page).toHaveURL(/\/login\/mfa$/);
  } finally {
    await withPg((pg) => pg.query('delete from self_auth.totp_factor where user_id = (select user_id from public.profiles where email = $1)', [email]));
  }
});

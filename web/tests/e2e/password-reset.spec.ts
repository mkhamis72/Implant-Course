import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import { authenticator } from 'otplib';
import { pgConfig } from '../../scripts/db';
import { ensureTenantUser, setProfile } from '../../scripts/users';
import { nodeAuth, sentEmails } from '../../scripts/self-auth-node';
import { ACADEMY_COMPANY_ID } from '../../src/lib/tenant/types';
import { login, expectDashboard } from './helpers';

const SENT = "If an account exists for that address, we've emailed a link to set a new password. It works for 24 hours.";

// A throwaway organizer login with a known password; deleted afterwards.
async function withUser(prefix: string, fn: (u: { id: string; email: string; password: string }) => Promise<void>) {
  const email = `icm-${prefix}-${Date.now()}@example.com`;
  const password = 'Old-password-123';
  const pg = new Client(pgConfig());
  await pg.connect();
  let id = '';
  try {
    id = await ensureTenantUser({ email, password, pending: { pg } });
    await setProfile(pg, id, { full_name: 'Reset Tester', role: 'organizer', active: true });
    await fn({ id, email, password });
  } finally {
    await pg.end();
    if (id) await (await nodeAuth()).admin.deleteUser(ACADEMY_COMPANY_ID, id);
  }
}

async function requestReset(page: Page, email: string) {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page).toHaveURL(/\/login\/forgot$/);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toHaveText(SENT);
}

// Mailpit (the local stack's mail catcher): the link in the newest reset email to this address.
async function resetLink(email: string): Promise<string> {
  let id = '';
  await expect
    .poll(
      async () => {
        const res = await fetch(`http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
        const messages: { ID: string; Subject: string }[] = (await res.json()).messages ?? [];
        id = messages.find((m) => m.Subject === 'Reset your password')?.ID ?? '';
        return id;
      },
      { timeout: 20_000 },
    )
    .not.toBe('');
  const html: string = (await (await fetch(`http://127.0.0.1:54324/api/v1/message/${id}`)).json()).HTML;
  const href = html.match(/href="([^"]+)"/)![1].replace(/&amp;/g, '&');
  expect(href).toMatch(/\/auth\/reset\?token=.+$/);
  return href;
}

/** The email names the app's host; the test browser uses its own base URL, so keep only path and query. */
const asPath = (href: string) => new URL(href).pathname + new URL(href).search;

async function setNewPassword(page: Page, password: string) {
  await expect(page).toHaveURL(/\/auth\/reset\?token=/);
  await page.getByLabel('New password').fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page).toHaveURL(/\/login\?notice=password_reset$/);
  await expect(page.getByRole('status').filter({ hasText: 'Your password is changed' })).toBeVisible();
}

test('a user resets a forgotten password by email and signs in with the new one', async ({ page }) => {
  await withUser('reset', async ({ email }) => {
    await requestReset(page, email);
    await page.goto(asPath(await resetLink(email)));
    await setNewPassword(page, 'New-password-456');

    await login(page, email, 'New-password-456');
    await expectDashboard(page);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    // The old password no longer works.
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('Old-password-123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText('Incorrect email or password.');
  });
});

test('a reset link works once', async ({ page }) => {
  await withUser('reset-once', async ({ email }) => {
    await requestReset(page, email);
    const path = asPath(await resetLink(email));
    await page.goto(path);
    await setNewPassword(page, 'New-password-456');
    await page.goto(path);
    await page.getByLabel('New password').fill('Another-password-789');
    await page.getByLabel('Confirm password').fill('Another-password-789');
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('invalid or has expired');
  });
});

test('an unknown address gets the same reply', async ({ page }) => {
  await requestReset(page, `icm-nobody-${Date.now()}@example.com`);
});

test('with 2FA, signing in with the new password still asks for the code', async ({ page }) => {
  test.setTimeout(90_000);
  await withUser('reset-mfa', async ({ email, password }) => {
    // Enrol an authenticator as the user, through the package.
    const auth = await nodeAuth();
    const signedIn = await auth.signIn({ companyId: ACADEMY_COMPANY_ID, email, password });
    if (!signedIn.ok) throw new Error('sign-in failed');
    const { secret } = await auth.totp.startEnroll(signedIn.sessionToken, ACADEMY_COMPANY_ID);
    const first = authenticator.generate(secret);
    expect(await auth.totp.confirmEnroll(signedIn.sessionToken, ACADEMY_COMPANY_ID, first)).not.toBeNull();
    await auth.signOut(signedIn.sessionToken);

    const before = sentEmails.length;
    await auth.requestPasswordReset({ companyId: ACADEMY_COMPANY_ID, email });
    const token = new URL(sentEmails.slice(before).find((m) => m.to === email)!.url).searchParams.get('token')!;
    await page.goto(`/auth/reset?token=${encodeURIComponent(token)}`);
    await setNewPassword(page, 'New-password-789');

    await login(page, email, 'New-password-789');
    await expect(page).toHaveURL(/\/login\/mfa$/);
    let code = authenticator.generate(secret);
    while (code === first) {
      await new Promise((r) => setTimeout(r, 1000));
      code = authenticator.generate(secret);
    }
    await page.getByLabel('Authentication code').fill(code);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expectDashboard(page);
  });
});

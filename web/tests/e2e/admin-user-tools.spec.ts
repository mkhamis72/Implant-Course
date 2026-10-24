import { test, expect, type Browser, type Page } from '@playwright/test';
import { Client } from 'pg';
import { authenticator } from 'otplib';
import { pgConfig } from '../../scripts/db';
import { adminClient, setProfile } from '../../scripts/users';
import { TEST_USERS } from '../support/test-users';
import { login, expectDashboard } from './helpers';

// A throwaway organizer login with a known password; deleted afterwards.
async function withUser(prefix: string, fn: (u: { id: string; email: string; password: string }) => Promise<void>) {
  const admin = adminClient();
  const email = `icm-${prefix}-${Date.now()}@example.com`;
  const password = 'Tools-password-123';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  expect(error).toBeNull();
  const id = data.user!.id;
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    await setProfile(pg, id, { full_name: 'E2E Tools Tester', role: 'organizer', active: true });
    await fn({ id, email, password });
  } finally {
    await pg.end();
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
}

/** Signs in as the user in a separate browser, runs fn, closes it. */
async function asUser(browser: Browser, email: string, password: string, fn: (page: Page) => Promise<void>) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await login(page, email, password);
    await fn(page);
  } finally {
    await context.close();
  }
}

/** Sets up an authenticator on the security page and returns its secret. */
async function enrollTotp(page: Page): Promise<string> {
  await page.goto('/account/security');
  await page.getByRole('button', { name: 'Set up authenticator' }).click();
  const secret = (await page.getByTestId('totp-secret').textContent())!.trim();
  await page.getByLabel('Code from app').fill(authenticator.generate(secret));
  await page.getByRole('button', { name: 'Activate' }).click();
  await expect(page.getByText('Authenticator active')).toBeVisible();
  return secret;
}

type MailpitMessage = { ID: string; Subject: string };

async function newestMail(to: string, subject: string): Promise<{ Text: string; HTML: string }> {
  let id = '';
  await expect
    .poll(
      async () => {
        const res = await fetch(`http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
        const messages: MailpitMessage[] = (await res.json()).messages ?? [];
        id = messages.find((m) => m.Subject === subject)?.ID ?? '';
        return id;
      },
      { timeout: 20_000 },
    )
    .not.toBe('');
  return (await fetch(`http://127.0.0.1:54324/api/v1/message/${id}`)).json();
}

test('an admin changes a user’s email: notice without a link, sign-in with the new address, History', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await withUser('email-change', async ({ email, password }) => {
    // Signed in once, so the old address gets the notice too.
    await asUser(browser, email, password, expectDashboard);

    const newEmail = `icm-email-changed-${Date.now()}@example.com`;
    await login(page, TEST_USERS.admin.email);
    await page.goto('/admin/users');
    const row = page.getByTestId(`user-row-${email}`);
    await row.getByRole('button', { name: `Change email of ${email}` }).click();
    await expect(row.getByText(/signed out everywhere/)).toBeVisible();
    await row.getByLabel('New email').fill(newEmail.toUpperCase());
    await row.getByRole('button', { name: 'Change email', exact: true }).click();

    const newRow = page.getByTestId(`user-row-${newEmail}`);
    await expect(newRow.getByText(`Email changed to ${newEmail}.`)).toBeVisible();

    for (const to of [newEmail, email]) {
      const mail = await newestMail(to, 'Your sign-in email was changed');
      expect(mail.Text).toContain(`was changed to ${newEmail} by an administrator`);
      expect(mail.Text).not.toMatch(/https?:/);
      expect(mail.HTML).not.toMatch(/href=|https?:/);
    }

    await asUser(browser, newEmail, password, expectDashboard);

    await page.reload();
    await newRow.getByText('History').click();
    await expect(newRow.getByText(/^Email changed by Test Admin · /)).toBeVisible();
  });
});

test('an admin resets 2FA: the user must set it up again before the app works', async ({ page, browser }) => {
  test.setTimeout(150_000);
  await withUser('mfa-reset', async ({ email, password }) => {
    await asUser(browser, email, password, async (theirs) => {
      await enrollTotp(theirs);
    });

    await login(page, TEST_USERS.admin.email);
    await page.goto('/admin/users');
    const row = page.getByTestId(`user-row-${email}`);
    await row.getByRole('button', { name: `Reset 2FA for ${email}` }).click();
    await expect(row.getByText(/signed out everywhere/)).toBeVisible();
    await row.getByRole('button', { name: 'Reset 2FA', exact: true }).click();
    await expect(row.getByText('Two-factor authentication reset. They must set it up again when they next sign in.')).toBeVisible();
    await expect(row.getByRole('button', { name: `Reset 2FA for ${email}` })).toHaveCount(0);
    await row.getByText('History').click();
    await expect(row.getByText(/^2FA reset by Test Admin · /)).toBeVisible();

    // Next sign-in: password only (no factor left), then straight to the security page.
    await asUser(browser, email, password, async (theirs) => {
      await expect(theirs).toHaveURL(/\/account\/security$/);
      await expect(theirs.getByText('An administrator reset your two-factor authentication.', { exact: false })).toBeVisible();
      await theirs.goto('/patients');
      await expect(theirs).toHaveURL(/\/account\/security$/);

      await enrollTotp(theirs);
      await theirs.goto('/');
      await expectDashboard(theirs);
      await theirs.goto('/patients');
      await expect(theirs).toHaveURL(/\/patients$/);
    });
  });
});

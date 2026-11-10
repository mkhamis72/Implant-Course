import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import { pgConfig } from '../../scripts/db';
import { pendingLoginFor, setProfile } from '../../scripts/users';
import { nodeAuth, sentEmails } from '../../scripts/self-auth-node';
import { ACADEMY_COMPANY_ID } from '../../src/lib/tenant/types';
import { TEST_USERS } from '../support/test-users';
import { expectDashboard, login } from './helpers';
import { mailedLink } from './logins';

/** An invited (passwordless) academy login: the pending row first, then Self-Auth's invite; returns the link's path. */
async function invited(email: string, fullName: string): Promise<{ userId: string; path: string }> {
  await pendingLoginFor(email);
  const auth = await nodeAuth();
  const before = sentEmails.length;
  const { userId } = await auth.admin.invite({ companyId: ACADEMY_COMPANY_ID, email });
  const url = sentEmails.slice(before).find((m) => m.to === email && m.kind === 'invite')!.url;
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    await setProfile(pg, userId, { full_name: fullName, role: 'organizer', active: true });
  } finally {
    await pg.end();
  }
  return { userId, path: new URL(url).pathname + new URL(url).search };
}

const remove = async (userId: string) => (await nodeAuth()).admin.deleteUser(ACADEMY_COMPANY_ID, userId).catch(() => {});

test('invited user accepts the invite, sets a password, signs in and reaches the dashboard', async ({ page }) => {
  const email = `icm-invite-${Date.now()}@example.com`;
  const { userId, path } = await invited(email, 'Invited Organizer');
  try {
    await page.goto(path);
    await expect(page).toHaveURL(/\/auth\/invite\?token=/);
    await page.getByLabel('New password').fill('Fresh-password-123');
    await page.getByLabel('Confirm password').fill('Fresh-password-123');
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(page).toHaveURL(/\/login\?notice=invite_accepted$/);
    await login(page, email, 'Fresh-password-123');
    await expectDashboard(page);
  } finally {
    await remove(userId);
  }
});

test('mismatched passwords are rejected', async ({ page }) => {
  const email = `icm-invite-mm-${Date.now()}@example.com`;
  const { userId, path } = await invited(email, 'Invited Mismatch');
  try {
    await page.goto(path);
    await page.getByLabel('New password').fill('Fresh-password-123');
    await page.getByLabel('Confirm password').fill('Different-password-1');
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText('The passwords do not match.');
  } finally {
    await remove(userId);
  }
});

test('an admin resends a pending invite: the invited user gets a fresh working link', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const email = `icm-invite-again-${Date.now()}@example.com`;
  const { userId } = await invited(email, 'Invited Again');
  try {
    await login(page, TEST_USERS.admin.email);
    await page.goto('/admin/users');
    const row = page.getByTestId(`user-row-${email}`);
    await row.getByRole('button', { name: `Resend invite to ${email}` }).click();
    await expect(row.getByText(`Invitation sent again to ${email}.`)).toBeVisible();

    const other = await browser.newContext();
    const theirs = await other.newPage();
    await theirs.goto(await mailedLink(email, 'Reset your password'));
    await theirs.getByLabel('New password').fill('Fresh-password-123');
    await theirs.getByLabel('Confirm password').fill('Fresh-password-123');
    await theirs.getByRole('button', { name: 'Save password' }).click();
    await login(theirs, email, 'Fresh-password-123');
    await expectDashboard(theirs);
    await other.close();

    // With a password set, the invite is no longer pending.
    await page.reload();
    await expect(row.getByRole('button', { name: `Resend invite to ${email}` })).toHaveCount(0);
  } finally {
    await remove(userId);
  }
});

test('invalid invite token shows friendly error', async ({ page }) => {
  await page.goto('/auth/invite?token=not-a-real-token');
  await page.getByLabel('New password').fill('Fresh-password-123');
  await page.getByLabel('Confirm password').fill('Fresh-password-123');
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('This link is invalid or has expired. Ask an admin to send a new invite.');
});

test('link without a token shows friendly error', async ({ page }) => {
  await page.goto('/auth/invite');
  await expect(page).toHaveURL(/\/auth\/error\?code=missing_token/);
  await expect(page.getByText('This link is incomplete. Open the link from your email again.')).toBeVisible();
});

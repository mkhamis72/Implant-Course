import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { nodeAuth } from '../../scripts/self-auth-node';
import { ACADEMY_COMPANY_ID } from '../../src/lib/tenant/types';
import { login } from './helpers';
import { mailedLink, withLogin } from './logins';

test.describe('admin users', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, TEST_USERS.admin.email);
    await page.getByRole('link', { name: 'Admin' }).click();
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  });

  test('lists users with their roles and status', async ({ page }) => {
    const row = page.getByTestId(`user-row-${TEST_USERS.organizer.email}`);
    await expect(row).toContainText('Test Organizer');
    await expect(row).toContainText('Active');
  });

  test('cannot deactivate or demote own account', async ({ page }) => {
    const own = page.getByTestId(`user-row-${TEST_USERS.admin.email}`);
    await expect(own.getByRole('button', { name: 'Deactivate' })).toHaveCount(0);
    await expect(own.getByRole('button', { name: 'Change role' })).toHaveCount(0);
    await expect(own).toContainText('(you)');
  });

  test('deactivates and reactivates a user', async ({ page }) => {
    const row = page.getByTestId(`user-row-${TEST_USERS.target.email}`);
    await row.getByRole('button', { name: 'Deactivate', exact: true }).click();
    await expect(row).toContainText('Inactive');
    await row.getByRole('button', { name: 'Reactivate' }).click();
    await expect(row).toContainText('Active');
  });

  test('changes a role and back', async ({ page }) => {
    const row = page.getByTestId(`user-row-${TEST_USERS.target.email}`);
    await row.getByLabel('Role').selectOption('admin');
    await row.getByRole('button', { name: 'Change role' }).click();
    await expect(row.getByText('Role updated.')).toBeVisible();
    await row.getByLabel('Role').selectOption('organizer');
    await row.getByRole('button', { name: 'Change role' }).click();
    await expect(row.getByText('Role updated.')).toBeVisible();
  });

  test('invite form validates and reports duplicates', async ({ page }) => {
    const form = page.getByTestId('invite-form');
    await form.getByLabel('Full name').fill('Someone');
    await form.getByLabel('Email').fill(`  ${TEST_USERS.organizer.email.toUpperCase()} `);
    await form.getByRole('button', { name: 'Send invite' }).click();
    await expect(form.getByRole('alert')).toHaveText('A user with this email already exists.');
  });
});

// EMAIL_ENABLED=false (in the environment of both Playwright and the dev server) runs the email-off variants.
const emailOff = process.env.EMAIL_ENABLED === 'false';

test('an admin resets a lost password by email, the user signs in with the new one, then the admin deletes the user', async ({ page, browser }) => {
  test.skip(emailOff, 'email is off');
  test.setTimeout(120_000);
  await withLogin('remove', async ({ id, email }) => {
    await login(page, TEST_USERS.admin.email);
    await page.goto('/admin/users');
    const row = page.getByTestId(`user-row-${email}`);
    await row.getByRole('button', { name: `Reset password for ${email}` }).click();
    await expect(row.getByText(`Password reset email sent to ${email}.`)).toBeVisible();
    // The admin is never shown a password or a link.
    await expect(row.getByTestId('temporary-password')).toHaveCount(0);

    const other = await browser.newContext();
    const theirPage = await other.newPage();
    await theirPage.goto(await mailedLink(email, 'Reset your password'));
    const password = 'Chosen-by-user-123';
    await theirPage.getByLabel('New password').fill(password);
    await theirPage.getByLabel('Confirm password').fill(password);
    await theirPage.getByRole('button', { name: 'Save password' }).click();
    await expect(theirPage).toHaveURL(/\/login\?notice=password_reset$/);
    await login(theirPage, email, password);
    await expect(theirPage.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await other.close();

    await page.reload();
    await row.getByRole('button', { name: `Delete user ${email}` }).click();
    await row.getByLabel('Type E2E Tools Tester to confirm').fill('E2E Tools Tester');
    await row.getByRole('button', { name: 'Delete user' }).click();
    await expect(page.getByTestId(`user-row-${email}`)).toHaveCount(0);
    expect((await (await nodeAuth()).admin.listUsers(ACADEMY_COMPANY_ID)).some((u) => u.userId === id)).toBe(false);
  });
});

test('a deactivated user is signed out at once and cannot sign in until reactivated', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await withLogin('deactivate', async ({ email, password }) => {
    const theirs = await browser.newContext();
    try {
      const theirPage = await theirs.newPage();
      await login(theirPage, email, password);
      await expect(theirPage.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

      await login(page, TEST_USERS.admin.email);
      await page.goto('/admin/users');
      const row = page.getByTestId(`user-row-${email}`);
      await row.getByRole('button', { name: 'Deactivate', exact: true }).click();
      await expect(row).toContainText('Inactive');

      await theirPage.reload();
      await expect(theirPage).toHaveURL(/\/login/);
      await row.getByRole('button', { name: 'Reactivate' }).click();
      await expect(row).toContainText('Active');
      await login(theirPage, email, password);
      await expect(theirPage.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    } finally {
      await theirs.close();
    }
  });
});

test('organizer is redirected away from admin pages', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
});

test('admin edits settings with validation', async ({ page }) => {
  await login(page, TEST_USERS.admin.email);
  await page.goto('/admin/settings');
  const timeout = page.getByLabel('Session timeout (minutes)');
  const original = await timeout.inputValue();

  await timeout.fill('2');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Session timeout must be between 5 and 480 minutes.');

  await timeout.fill('45');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Session timeout (minutes)')).toHaveValue('45');

  await page.getByLabel('Session timeout (minutes)').fill(original);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
});

test('email_off_reset_shows_one_time_password: the admin sees it once, the member signs in with it, old sessions are gone', async ({ page, browser }) => {
  test.skip(!emailOff, 'needs EMAIL_ENABLED=false');
  test.setTimeout(120_000);
  await withLogin('otp', async ({ email, password }) => {
    const theirs = await browser.newContext();
    try {
      const theirPage = await theirs.newPage();
      await login(theirPage, email, password);
      await expect(theirPage.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

      await login(page, TEST_USERS.admin.email);
      await page.goto('/admin/users');
      const row = page.getByTestId(`user-row-${email}`);
      await row.getByRole('button', { name: `Reset password for ${email}` }).click();
      const otp = (await row.getByTestId('temporary-password').locator('code').textContent())!;
      expect(otp).toMatch(/^[A-Za-z0-9_-]{16,}$/);

      await theirPage.reload();
      await expect(theirPage).toHaveURL(/\/login/);
      await theirPage.getByLabel('Email').fill(email);
      await theirPage.getByLabel('Password').fill(password);
      await theirPage.getByRole('button', { name: 'Sign in' }).click();
      await expect(theirPage.getByRole('main').getByRole('alert')).toHaveText('Incorrect email or password.');
      await login(theirPage, email, otp);
      await expect(theirPage.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

      // Shown once: a reload of the admin page does not show it again.
      await page.reload();
      await expect(page.getByTestId('temporary-password')).toHaveCount(0);
    } finally {
      await theirs.close();
    }
  });
});

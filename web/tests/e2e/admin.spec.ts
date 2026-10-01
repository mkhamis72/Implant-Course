import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';

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
    await row.getByRole('button', { name: 'Deactivate' }).click();
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

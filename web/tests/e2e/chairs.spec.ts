import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { uniqueName } from './patients';

test('admin adds, renames and deactivates a chair', async ({ page }) => {
  await login(page, TEST_USERS.admin.email);
  await page.goto('/admin/chairs');
  const name = uniqueName('Chair');
  await page.getByLabel('New chair').fill(name);
  await page.getByRole('button', { name: 'Add chair' }).click();
  const row = page.getByTestId(`chair-row-${name}`);
  await expect(row).toBeVisible();
  await row.getByLabel('Name').fill(`${name} B`);
  await row.getByLabel('Active').uncheck();
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId(`chair-row-${name} B`)).toContainText('Inactive');
});

test('organizers cannot open chair settings', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  await page.goto('/admin/chairs');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
});

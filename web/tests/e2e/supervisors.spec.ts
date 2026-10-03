import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { uniqueName } from './patients';

test('admin adds, renames and deactivates a supervisor', async ({ page }) => {
  await login(page, TEST_USERS.admin.email);
  await page.goto('/admin/supervisors');
  const name = uniqueName('Prof');
  await page.getByLabel('New supervisor').fill(name);
  await page.getByRole('button', { name: 'Add supervisor' }).click();
  const row = page.getByTestId(`supervisor-row-${name}`);
  await expect(row).toBeVisible();
  await row.getByLabel('Name').fill(`${name} B`);
  await row.getByLabel('Active').uncheck();
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId(`supervisor-row-${name} B`)).toContainText('Inactive');
});

test('organizers cannot open supervisor settings', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  await page.goto('/admin/supervisors');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
});

import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { uniqueName } from './patients';

test('admin adds, renames and deactivates a lecturer', async ({ page }) => {
  await login(page, TEST_USERS.admin.email);
  await page.goto('/admin/lecturers');
  const name = uniqueName('Lecturer');
  await page.getByLabel('New lecturer').fill(name);
  await page.getByRole('button', { name: 'Add lecturer' }).click();
  const row = page.getByTestId(`lecturer-row-${name}`);
  await expect(row).toBeVisible();
  await row.getByLabel('Name').fill(`${name} B`);
  await row.getByLabel('Active').uncheck();
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId(`lecturer-row-${name} B`)).toContainText('Inactive');
});

test('organizers cannot open lecturer settings', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  await page.goto('/admin/lecturers');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
});

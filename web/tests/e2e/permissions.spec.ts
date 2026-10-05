import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { uniqueName } from './patients';
import { apiAs, randomFutureDate, seedCourse } from './api';

// TEST_USERS.viewer: View on every panel, Edit on Inventory only.

test('a view-only organizer sees courses and the schedule without edit controls', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const date = randomFutureDate();
  const courseId = await seedCourse(api, { name: uniqueName('Course'), start: date, end: date });

  await login(page, TEST_USERS.viewer.email);
  await page.goto('/courses');
  await expect(page.getByRole('heading', { level: 1, name: 'Courses' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create course' })).toHaveCount(0);

  await page.goto(`/courses/${courseId}`);
  await expect(page.getByRole('button', { name: 'Save course' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add session' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete course' })).toHaveCount(0);

  await page.goto(`/schedule?date=${date}`);
  await expect(page.getByRole('link', { name: 'New booking' })).toHaveCount(0);
  await page.goto(`/schedule/lectures?date=${date}`);
  await expect(page.getByRole('link', { name: 'New talk' })).toHaveCount(0);
});

test('a view-only organizer is sent away from edit-only pages, but can use the panel they edit', async ({ page }) => {
  await login(page, TEST_USERS.viewer.email);
  await page.goto('/schedule/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await page.goto('/patients/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await page.goto('/inventory/receive');
  await expect(page.getByRole('heading', { level: 1, name: 'Receive stock' })).toBeVisible();
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
});

test('an admin changes an organizer’s permissions from the Users page', async ({ page }) => {
  await login(page, TEST_USERS.admin.email);
  await page.goto('/admin/users');
  const row = page.getByTestId(`user-row-${TEST_USERS.viewer.email}`);
  await row.getByText('Permissions', { exact: true }).click();
  const patients = row.getByRole('group', { name: 'Patients' });
  await expect(patients.getByRole('radio', { name: 'View' })).toBeChecked();
  await patients.getByRole('radio', { name: 'None' }).check();
  await row.getByRole('button', { name: 'Save permissions' }).click();
  await expect(row.getByText('Permissions saved.')).toBeVisible();

  // Put it back for the other specs (global setup pins it again on the next run anyway).
  await page.reload();
  await row.getByText('Permissions', { exact: true }).click();
  await expect(row.getByRole('group', { name: 'Patients' }).getByRole('radio', { name: 'None' })).toBeChecked();
  await row.getByRole('group', { name: 'Patients' }).getByRole('radio', { name: 'View' }).check();
  await row.getByRole('button', { name: 'Save permissions' }).click();
  await expect(row.getByText('Permissions saved.')).toBeVisible();
});

test('a delegate login shows as Delegate, without a role switch or permission grid', async ({ page }) => {
  await login(page, TEST_USERS.admin.email);
  await page.goto('/admin/users');
  const row = page.getByTestId(`user-row-${TEST_USERS.delegate.email}`);
  await expect(row).toContainText('Delegate');
  await expect(row.getByRole('combobox', { name: 'Role' })).toHaveCount(0);
  await expect(row.getByText('Permissions', { exact: true })).toHaveCount(0);
});

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

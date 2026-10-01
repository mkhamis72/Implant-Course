import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login, expectDashboard } from './helpers';

test('a session left idle past the timeout is ended by the server on the next request', async ({ page, context }) => {
  await login(page, TEST_USERS.organizer.email);
  await expectDashboard(page);
  const twoHoursAgo = String(Date.now() - 2 * 60 * 60 * 1000);
  await context.addCookies([{ name: 'icm_last_seen', value: twoHoursAgo, url: 'http://localhost:3000' }]);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login\?reason=idle$/);
  await expect(page.getByText('You were signed out after a period of inactivity.')).toBeVisible();
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});

test('recent activity keeps the session', async ({ page, context }) => {
  await login(page, TEST_USERS.organizer.email);
  await context.addCookies([{ name: 'icm_last_seen', value: String(Date.now() - 60_000), url: 'http://localhost:3000' }]);
  await page.goto('/');
  await expectDashboard(page);
});

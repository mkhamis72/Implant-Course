import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import { pgConfig } from '../../scripts/db';
import { adminClient } from '../../scripts/users';
import { TEST_PASSWORD, TEST_USERS } from '../support/test-users';
import { login } from './helpers';

test('a signed-in user without a profile sees "Account deactivated", not a redirect loop', async ({ page }) => {
  const admin = adminClient();
  const email = `icm-noprofile-${Date.now()}@example.com`;
  const { data } = await admin.auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true });
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    await pg.query('delete from public.profiles where user_id = $1', [data.user!.id]);
    await login(page, email);
    await expect(page.getByRole('heading', { name: 'Account deactivated' })).toBeVisible();
  } finally {
    await pg.end();
    await admin.auth.admin.deleteUser(data.user!.id);
  }
});

test('an inactive account cannot use the set-password page', async ({ page }) => {
  await login(page, TEST_USERS.inactive.email);
  await page.goto('/account/set-password');
  await expect(page.getByRole('heading', { name: 'Account deactivated' })).toBeVisible();
});

test('a repeated query parameter does not crash the booking page', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  await page.goto('/schedule/new?date=2030-01-01&date=2030-01-02&chair=a&chair=b');
  await expect(page.getByRole('heading', { level: 1, name: 'Book a surgery' })).toBeVisible();
});

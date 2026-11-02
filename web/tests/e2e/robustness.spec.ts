import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import { pgConfig } from '../../scripts/db';
import { adminClient } from '../../scripts/users';
import { TEST_PASSWORD, TEST_USERS } from '../support/test-users';
import { login } from './helpers';

async function signInRefused(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('You do not have access to this company.');
}

// No profile means no company membership: sign-in refuses the session instead of looping between pages.
test('a user without a profile is refused at sign-in, not sent round a redirect loop', async ({ page }) => {
  const admin = adminClient();
  const email = `icm-noprofile-${Date.now()}@example.com`;
  const { data } = await admin.auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true });
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    await pg.query('delete from public.profiles where user_id = $1', [data.user!.id]);
    await signInRefused(page, email);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  } finally {
    await pg.end();
    await admin.auth.admin.deleteUser(data.user!.id);
  }
});

test('an inactive account cannot use the set-password page', async ({ page }) => {
  await signInRefused(page, TEST_USERS.inactive.email);
  await page.goto('/account/set-password');
  await expect(page).toHaveURL(/\/login$/);
});

test('a repeated query parameter does not crash the booking page', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  await page.goto('/schedule/new?date=2030-01-01&date=2030-01-02&chair=a&chair=b');
  await expect(page.getByRole('heading', { level: 1, name: 'Book a surgery' })).toBeVisible();
});

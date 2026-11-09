import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import { pgConfig } from '../../scripts/db';
import { ensureTenantUser } from '../../scripts/users';
import { nodeAuth } from '../../scripts/self-auth-node';
import { ACADEMY_COMPANY_ID } from '../../src/lib/tenant/types';
import { TEST_PASSWORD, TEST_USERS } from '../support/test-users';
import { login } from './helpers';

// No profile means no company membership (the row cascades), and sign-in refuses a non-member.
test('a user without a profile is refused at sign-in, not sent round a redirect loop', async ({ page }) => {
  const email = `icm-noprofile-${Date.now()}@example.com`;
  const pg = new Client(pgConfig());
  await pg.connect();
  let userId = '';
  try {
    userId = await ensureTenantUser({ email, password: TEST_PASSWORD, pending: { pg } });
    await pg.query('delete from public.profiles where user_id = $1', [userId]);
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText('You do not have access to this company.');
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  } finally {
    await pg.end();
    if (userId) await (await nodeAuth()).admin.deleteUser(ACADEMY_COMPANY_ID, userId).catch(() => {});
  }
});

test('a repeated query parameter does not crash the booking page', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  await page.goto('/schedule/new?date=2030-01-01&date=2030-01-02&chair=a&chair=b');
  await expect(page.getByRole('heading', { level: 1, name: 'Book a surgery' })).toBeVisible();
});

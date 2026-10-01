import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import { pgConfig } from '../../scripts/db';
import { adminClient, setProfile } from '../../scripts/users';
import { expectDashboard } from './helpers';

test('invited user accepts invite, sets a password and reaches the dashboard', async ({ page }) => {
  const admin = adminClient();
  const email = `icm-invite-${Date.now()}@example.com`;
  const { data, error } = await admin.auth.admin.generateLink({ type: 'invite', email });
  expect(error).toBeNull();
  const userId = data.user!.id;
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    await setProfile(pg, userId, { full_name: 'Invited Organizer', role: 'organizer', active: true });
    await page.goto(`/auth/confirm?token_hash=${data.properties!.hashed_token}&type=invite`);
    await expect(page).toHaveURL(/\/account\/set-password$/);
    await page.getByLabel('New password').fill('Fresh-password-123');
    await page.getByLabel('Confirm password').fill('Fresh-password-123');
    await page.getByRole('button', { name: 'Save password' }).click();
    await expectDashboard(page);
  } finally {
    await pg.end();
    await admin.auth.admin.deleteUser(userId);
  }
});

test('mismatched passwords are rejected', async ({ page }) => {
  const admin = adminClient();
  const email = `icm-invite-mm-${Date.now()}@example.com`;
  const { data } = await admin.auth.admin.generateLink({ type: 'invite', email });
  try {
    await page.goto(`/auth/confirm?token_hash=${data.properties!.hashed_token}&type=invite`);
    await page.getByLabel('New password').fill('Fresh-password-123');
    await page.getByLabel('Confirm password').fill('Different-password-1');
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText('The passwords do not match.');
  } finally {
    await admin.auth.admin.deleteUser(data.user!.id);
  }
});

test('invalid invite token shows friendly error', async ({ page }) => {
  await page.goto('/auth/confirm?token_hash=not-a-real-token&type=invite');
  await expect(page).toHaveURL(/\/auth\/error/);
  await expect(page.getByText('This link is invalid or has expired. Ask an admin to send a new invite.')).toBeVisible();
});

test('link without a token shows friendly error', async ({ page }) => {
  await page.goto('/auth/confirm');
  await expect(page.getByText('This link is incomplete. Open the link from your email again.')).toBeVisible();
});

import { test, expect } from '@playwright/test';
import { TEST_USERS, TEST_PASSWORD } from '../support/test-users';
import { login, expectDashboard } from './helpers';

test('anonymous visitor is sent to login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});

test('organizer signs in, sees shell without Admin, and signs out', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  await expectDashboard(page);
  await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('wrong password shows a clear message and keeps the email', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(TEST_USERS.organizer.email);
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Incorrect email or password.');
  await expect(page.getByLabel('Email')).toHaveValue(TEST_USERS.organizer.email);
});

test('unverified email cannot sign in', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(TEST_USERS.unverified.email);
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Please verify your email first');
});

// Signing in binds the session to the company, which needs an active membership: the session ends at once.
test('an inactive user is refused at sign-in and stays signed out', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(TEST_USERS.inactive.email);
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('You do not have access to this company.');
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});

test('signed-in user visiting /login goes to dashboard', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  await page.goto('/login');
  await expectDashboard(page);
});

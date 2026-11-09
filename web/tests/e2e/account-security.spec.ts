import { test, expect, type Page } from '@playwright/test';
import { login, expectDashboard } from './helpers';
import { withLogin } from './logins';

// EMAIL_ENABLED=false (in the environment of both Playwright and the dev server) runs the email-off variant.
const emailOff = process.env.EMAIL_ENABLED === 'false';

async function changePassword(page: Page, current: string, next: string) {
  await page.goto('/account/security');
  await page.getByLabel('Current password', { exact: true }).fill(current);
  await page.getByLabel('New password', { exact: true }).fill(next);
  await page.getByLabel('Confirm new password', { exact: true }).fill(next);
  await page.getByRole('button', { name: 'Change password' }).click();
}

/** Changes the password, checks the other device is signed out and only the new password signs in. */
async function changeOwnPasswordFlow(page: Page, browser: import('@playwright/test').Browser, email: string, password: string) {
  const other = await browser.newContext();
  try {
    const otherPage = await other.newPage();
    await login(otherPage, email, password);
    await expectDashboard(otherPage);

    await login(page, email, password);
    await changePassword(page, 'not-my-password-1', 'Brand-new-pass-456');
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(/current password is not correct/);

    const next = 'Brand-new-pass-456';
    await changePassword(page, password, next);
    await expect(page.getByText('Your password was changed. Other devices were signed out.')).toBeVisible();
    // This session stays; the other device is signed out.
    await page.goto('/');
    await expectDashboard(page);
    await otherPage.reload();
    await expect(otherPage).toHaveURL(/\/login/);

    await otherPage.getByLabel('Email').fill(email);
    await otherPage.getByLabel('Password').fill(password);
    await otherPage.getByRole('button', { name: 'Sign in' }).click();
    await expect(otherPage.getByRole('main').getByRole('alert')).toHaveText('Incorrect email or password.');
    await login(otherPage, email, next);
    await expectDashboard(otherPage);
  } finally {
    await other.close();
  }
}

test('change_own_password: current password checked, other devices signed out, reset link offered as "Forgot your password?"', async ({ page, browser }) => {
  test.skip(emailOff, 'email is off (see change_own_password_email_off)');
  test.setTimeout(120_000);
  await withLogin('own-pw', async ({ email, password }) => {
    await changeOwnPasswordFlow(page, browser, email, password);
    await page.goto('/account/security');
    await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Email me a reset link' })).toBeVisible();
  });
});

test('change_own_password_email_off: a member changes their own password without email', async ({ page, browser }) => {
  test.skip(!emailOff, 'needs EMAIL_ENABLED=false');
  test.setTimeout(120_000);
  await withLogin('own-pw-off', async ({ email, password }) => {
    await changeOwnPasswordFlow(page, browser, email, password);
    await page.goto('/account/security');
    await expect(page.getByRole('button', { name: 'Email me a reset link' })).toHaveCount(0);
  });
});

import { test, expect } from '@playwright/test';
import { authenticator } from 'otplib';
import { TEST_USERS } from '../support/test-users';
import { login, expectDashboard } from './helpers';

async function freshCode(secret: string, notThis: string): Promise<string> {
  let code = authenticator.generate(secret);
  while (code === notThis) {
    await new Promise((r) => setTimeout(r, 1000));
    code = authenticator.generate(secret);
  }
  return code;
}

test('user enables 2FA, must use it at next sign-in, then removes it', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, TEST_USERS.mfa.email);
  await page.goto('/account/security');
  await page.getByRole('button', { name: 'Set up authenticator' }).click();
  const secret = (await page.getByTestId('totp-secret').textContent())!.trim();
  const firstCode = authenticator.generate(secret);
  await page.getByLabel('Code from app').fill(firstCode);
  await page.getByRole('button', { name: 'Activate' }).click();
  await expect(page.getByText('Authenticator active')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await login(page, TEST_USERS.mfa.email);
  await expect(page).toHaveURL(/\/login\/mfa$/);
  await page.goto('/account/security');
  await expect(page).toHaveURL(/\/login\/mfa$/);

  await page.getByLabel('Authentication code').fill('000000');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    'That code is not correct. Check your authenticator app and try again.',
  );

  await page.getByLabel('Authentication code').fill(await freshCode(secret, firstCode));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expectDashboard(page);

  await page.goto('/account/security');
  await page.getByRole('button', { name: 'Remove authenticator' }).click();
  await expect(page.getByRole('button', { name: 'Set up authenticator' })).toBeVisible();
});

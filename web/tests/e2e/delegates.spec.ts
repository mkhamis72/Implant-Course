import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { uniqueName } from './patients';

test.beforeEach(async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
});

test('adds, edits and deactivates a delegate', async ({ page }) => {
  const name = uniqueName('Dr Delegate');
  await page.getByRole('link', { name: 'Delegates' }).click();
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Licence number').fill('EG-555');
  await page.getByRole('button', { name: 'Add delegate' }).click();
  const row = page.getByTestId(`delegate-row-${name}`);
  await expect(row).toContainText('EG-555');
  await expect(page.getByLabel('Full name')).toHaveValue('');

  await row.getByRole('link', { name }).click();
  await page.getByLabel('Phone').fill('0100 999 8888');
  await page.getByLabel('Active').uncheck();
  await page.getByRole('button', { name: 'Save delegate' }).click();
  await expect(page.getByText('Delegate saved.')).toBeVisible();
  await page.getByRole('link', { name: 'Delegates' }).click();
  await expect(page.getByTestId(`delegate-row-${name}`)).toContainText('Inactive');
});

test('a too-short name is refused and the input kept', async ({ page }) => {
  await page.goto('/delegates');
  await page.getByLabel('Full name').fill('K');
  await page.getByLabel('Licence number').fill('EG-1');
  await page.getByRole('button', { name: 'Add delegate' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Enter the delegate’s full name (at least 2 characters).');
  await expect(page.getByLabel('Licence number')).toHaveValue('EG-1');
});

test('deletes a delegate added by mistake', async ({ page }) => {
  const name = uniqueName('Dr Mistake');
  await page.goto('/delegates');
  await page.getByLabel('Full name').fill(name);
  await page.getByRole('button', { name: 'Add delegate' }).click();
  await page.getByTestId(`delegate-row-${name}`).getByRole('link', { name }).click();
  await page.getByRole('button', { name: 'Delete delegate' }).click();
  await page.getByLabel(`Type ${name} to confirm`).fill(name);
  await page.getByRole('button', { name: 'Delete delegate' }).click();
  await expect(page).toHaveURL(/\/delegates$/);
  await expect(page.getByTestId(`delegate-row-${name}`)).toHaveCount(0);
});

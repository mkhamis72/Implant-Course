import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';

test('history lists chart, details and note changes with who did them', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  const id = await createPatientViaUi(page, { full_name: uniqueName('History') });
  await page.getByRole('button', { name: 'Tooth 36, Present' }).click();
  await page.getByRole('complementary', { name: 'Tooth details' }).getByRole('button', { name: 'Mark missing' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 36, Missing' })).toBeVisible();

  await page.goto(`/patients/${id}/overview`);
  await page.getByLabel('Phone').fill('0100 123 4567');
  await page.getByRole('button', { name: 'Save patient' }).click();
  await expect(page.getByText('Patient details saved.')).toBeVisible();

  await page.getByRole('link', { name: 'History' }).click();
  const entries = page.getByTestId('history-entry');
  await expect(entries.nth(0)).toContainText('Patient details changed: phone');
  await expect(entries.nth(1)).toContainText('Tooth 36: Present → Missing');
  await expect(entries.filter({ hasText: 'Patient created' })).toHaveCount(1);
  await expect(entries.first()).toContainText('Test Organizer');
});

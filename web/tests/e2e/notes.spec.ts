import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';

test.beforeEach(async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
});

test('adds a note with teeth that link to the chart', async ({ page }) => {
  const id = await createPatientViaUi(page, { full_name: uniqueName('Notes') });
  await page.getByRole('link', { name: 'Notes' }).click();
  await page.getByLabel('Note').fill('Sutures removed, healing well.');
  await page.getByLabel('Teeth (optional)').fill('46, 36 36');
  await page.getByRole('button', { name: 'Add note' }).click();
  const note = page.getByTestId('visit-note').first();
  await expect(note).toContainText('Sutures removed, healing well.');
  await expect(note).toContainText('Test Organizer');
  await expect(note.getByRole('link')).toHaveText(['36', '46']);
  await expect(page.getByLabel('Note')).toHaveValue('');
  await note.getByRole('link', { name: '36' }).click();
  await expect(page).toHaveURL(new RegExp(`/patients/${id}\\?tooth=36$`));
});

test('invalid tooth in note is rejected and the text is kept', async ({ page }) => {
  await createPatientViaUi(page, { full_name: uniqueName('Bad tooth') });
  await page.getByRole('link', { name: 'Notes' }).click();
  await page.getByLabel('Note').fill('Check 19');
  await page.getByLabel('Teeth (optional)').fill('19');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    '"19" is not a tooth number. Use FDI numbers 11–48 (e.g. 36, 46).',
  );
  await expect(page.getByLabel('Note')).toHaveValue('Check 19');
  await expect(page.getByTestId('visit-note')).toHaveCount(0);
});

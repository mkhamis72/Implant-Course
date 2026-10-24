import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';

test('header shows age and medical alerts; tabs are present', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  const id = await createPatientViaUi(page, { full_name: uniqueName('Alerts'), dob: '1970-01-15' });
  const header = page.getByTestId('patient-header');
  await expect(header).toContainText(/Age \d+/);
  await expect(page.getByRole('navigation', { name: 'Patient sections' }).getByRole('link')).toHaveText([
    'Chart', 'Implants', 'Overview', 'X-rays', 'Consent', 'Notes', 'History',
  ]);

  await page.getByRole('link', { name: 'Overview' }).click();
  await page.getByLabel('Allergies').fill('Penicillin');
  await page.getByRole('radiogroup', { name: 'Bisphosphonates' }).getByLabel('Yes', { exact: true }).check();
  await page.getByRole('button', { name: 'Save medical history' }).click();
  await expect(page.getByText('Medical history saved.')).toBeVisible();
  await expect(header.getByTestId('medical-alert')).toHaveText(['Allergy: Penicillin', 'Bisphosphonates']);

  await page.goto(`/patients/${id}`);
  await expect(page.getByTestId('patient-header').getByTestId('medical-alert')).toHaveCount(2);
});

test('edits details and archives / restores', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  const id = await createPatientViaUi(page, { full_name: uniqueName('Edit') });
  await page.goto(`/patients/${id}/overview`);
  await page.getByLabel('Phone').fill('0111 222 3333');
  await page.getByRole('button', { name: 'Save patient' }).click();
  await expect(page.getByText('Patient details saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Phone')).toHaveValue('0111 222 3333');

  await page.getByRole('button', { name: 'Archive patient' }).click();
  await expect(page.getByTestId('patient-header')).toContainText('Archived');
  await page.getByRole('button', { name: 'Restore patient' }).click();
  await expect(page.getByTestId('patient-header')).not.toContainText('Archived');
});

test('stale save shows who changed it', async ({ browser }) => {
  const a = await browser.newPage();
  const b = await browser.newPage();
  await login(a, TEST_USERS.organizer.email);
  const id = await createPatientViaUi(a, { full_name: uniqueName('Conflict') });
  await login(b, TEST_USERS.admin.email);
  await a.goto(`/patients/${id}/overview`);
  await b.goto(`/patients/${id}/overview`);

  await b.getByLabel('Phone').fill('0100 000 0001');
  await b.getByRole('button', { name: 'Save patient' }).click();
  await expect(b.getByText('Patient details saved.')).toBeVisible();

  await a.getByLabel('Phone').fill('0100 000 0002');
  await a.getByRole('button', { name: 'Save patient' }).click();
  await expect(a.getByRole('main').getByRole('alert')).toHaveText(
    /^This record was changed by Test Admin at \d\d:\d\d\. Reload to see it\.$/,
  );
  await expect(a.getByLabel('Phone')).toHaveValue('0100 000 0002');
  await a.close();
  await b.close();
});

/** Clicks a save button and waits for the server action's response (the old message may still be showing). */
async function saved(page: import('@playwright/test').Page, button: string) {
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/overview')),
    page.getByRole('button', { name: button }).click(),
  ]);
}

test('saving twice in a row is not mistaken for a conflict', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  const id = await createPatientViaUi(page, { full_name: uniqueName('Twice') });
  await page.goto(`/patients/${id}/overview`);
  await page.getByLabel('Phone').fill('0100 111 1111');
  await saved(page, 'Save patient');
  await expect(page.getByText('Patient details saved.')).toBeVisible();
  await page.getByLabel('Phone').fill('0100 222 2222');
  await saved(page, 'Save patient');
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('Patient details saved.')).toBeVisible();
  await page.getByRole('radiogroup', { name: 'Diabetes' }).getByLabel('Yes', { exact: true }).check();
  await saved(page, 'Save medical history');
  await expect(page.getByText('Medical history saved.')).toBeVisible();
  await page.getByRole('radiogroup', { name: 'Smoking' }).getByLabel('Current').check();
  await page.getByLabel('Cigarettes per day').fill('10');
  await saved(page, 'Save medical history');
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('Phone')).toHaveValue('0100 222 2222');
  await expect(page.getByRole('radiogroup', { name: 'Smoking' }).getByLabel('Current')).toBeChecked();
  await expect(page.getByLabel('Cigarettes per day')).toHaveValue('10');
  await expect(page.getByRole('radiogroup', { name: 'Bruxism / parafunction' }).getByLabel('Not assessed')).toBeChecked();
});

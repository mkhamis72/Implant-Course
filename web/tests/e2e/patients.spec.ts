import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { apiAs } from './api';
import { createPatientViaUi, uniqueName } from './patients';

test.beforeEach(async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
});

test('creates a patient and lands on their chart', async ({ page }) => {
  const name = uniqueName('Amira');
  await page.getByRole('link', { name: 'Patients' }).click();
  await page.getByRole('link', { name: 'New patient' }).click();
  await createPatientViaUi(page, { full_name: name, dob: '1980-05-20', phone: '0100 555 1234' });
  await expect(page.getByRole('group', { name: 'Odontogram' })).toBeVisible();
  await expect(page.getByTestId('patient-header')).toContainText(/File P\d{5,}/);
});

test('finds patients by name, file number and phone', async ({ page }) => {
  const name = uniqueName('Search');
  const fileNo = `E2E-${Date.now()}`;
  await createPatientViaUi(page, { full_name: name, file_no: fileNo, phone: '+20 122 777 8899' });
  for (const q of [name.slice(4, 14), fileNo.toLowerCase(), '1227778899']) {
    await page.goto(`/patients?q=${encodeURIComponent(q)}`);
    await expect(page.getByTestId(`patient-row-${fileNo}`)).toBeVisible();
  }
  await page.goto('/patients?q=%25_%27');
  await expect(page.getByRole('main')).toContainText('No patients found.');
});

test('invalid DOB keeps input', async ({ page }) => {
  const name = uniqueName('Dob');
  await page.goto('/patients/new');
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Phone').fill('0100');
  await page.getByLabel('Date of birth').fill('1800-01-01'); // a future date is already refused by the picker (max today)
  await page.getByRole('button', { name: 'Save patient' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Enter a real date of birth (not in the future, after 1900).');
  await expect(page.getByLabel('Full name')).toHaveValue(name);
  await expect(page.getByLabel('Phone')).toHaveValue('0100');
});

test('duplicate file number', async ({ page }) => {
  const fileNo = `E2E-DUP-${Date.now()}`;
  await createPatientViaUi(page, { full_name: uniqueName('First'), file_no: fileNo });
  await page.goto('/patients/new');
  await page.getByLabel('Full name').fill(uniqueName('Second'));
  await page.getByLabel('File number').fill(fileNo);
  await page.getByRole('button', { name: 'Save patient' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(`File number ${fileNo} is already used by another patient.`);
});

test('lists patients in pages of 50 with a total, keeping the search', async ({ page }) => {
  const base = uniqueName('Paging');
  const api = await apiAs(TEST_USERS.organizer.email);
  const names = Array.from({ length: 53 }, (_, i) => `${base} ${String(i).padStart(2, '0')}`);
  const { error } = await api.from('patients').insert(names.map((full_name) => ({ full_name })));
  expect(error).toBeNull();
  await page.goto(`/patients?q=${encodeURIComponent(base)}`);
  await expect(page.getByTestId('patient-count')).toHaveText('Patients 1–50 of 53');
  await expect(page.getByRole('link', { name: names[49], exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: names[50], exact: true })).toHaveCount(0);
  const pager = page.getByRole('navigation', { name: 'Pages' });
  await expect(pager.locator('[aria-current="page"]')).toHaveText('1');
  await pager.getByRole('link', { name: 'Next ›' }).click();
  await expect(page).toHaveURL(/[?&]page=2/);
  await expect(page.getByTestId('patient-count')).toHaveText('Patients 51–53 of 53');
  for (const n of names.slice(50)) await expect(page.getByRole('link', { name: n, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: names[0], exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Search patients')).toHaveValue(base);
  await pager.getByRole('link', { name: 'Page 1' }).click();
  await expect(page.getByTestId('patient-count')).toHaveText('Patients 1–50 of 53');
});

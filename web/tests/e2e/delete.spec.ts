import { test, expect, type Page } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, randomFutureDate, seedCourse, seedDelegate, seedImplantStock } from './api';

async function confirmDelete(page: Page, noun: string, name: string) {
  await page.getByRole('button', { name: `Delete ${noun}` }).click();
  const confirm = page.getByRole('button', { name: `Delete ${noun}` });
  await expect(confirm).toBeDisabled();
  await page.getByLabel(/to confirm/).fill(name);
  await confirm.click();
}

test('deletes a patient from the header after typing their name', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  const name = uniqueName('Delete me');
  const patientId = await createPatientViaUi(page, { full_name: name });
  await page.goto(`/patients/${patientId}`);
  await confirmDelete(page, 'patient', name);
  await expect(page).toHaveURL(/\/patients$/);
  await page.goto(`/patients/${patientId}`);
  await expect(page.getByText(/not found|could not be found/i).first()).toBeVisible();
});

test('refuses to delete a patient with a placed implant', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const delegate = await seedDelegate(api, uniqueName('Dr Keep'));
  const stock = await seedImplantStock(api, { brand: uniqueName('Keep'), qty: 1, lot: `E2E-K${Date.now()}`, expiry: null });
  await login(page, TEST_USERS.organizer.email);
  const name = uniqueName('Keep me');
  const patientId = await createPatientViaUi(page, { full_name: name });
  const me = (await api.auth.getUser()).data.user!.id;
  const { error } = await api.rpc('place_implant_v2', {
    p_patient: patientId, p_tooth: 36, p_product: stock.productId, p_lot: stock.lotId,
    p_placed_on: new Date().toISOString().slice(0, 10), p_placing_delegate: delegate, p_supervisor: me,
  });
  expect(error).toBeNull();
  await page.goto(`/patients/${patientId}/implants`);
  await confirmDelete(page, 'patient', name);
  await expect(page.getByRole('alert').filter({ hasText: 'Archive them instead' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/patients/${patientId}/implants`));
});

test('deletes a patient from the Patients list', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  const name = uniqueName('List delete');
  const fileNo = `E2E-L${Date.now()}`;
  await createPatientViaUi(page, { full_name: name, file_no: fileNo });
  await page.goto(`/patients?q=${encodeURIComponent(name)}`);
  const row = page.getByTestId(`patient-row-${fileNo}`);
  await row.getByRole('button', { name: `Delete ${name}` }).click();
  await row.getByLabel(/to confirm/).fill(name);
  await row.getByRole('button', { name: 'Delete patient' }).click();
  await expect(page).toHaveURL(/\/patients$/);
  await page.goto(`/patients?q=${encodeURIComponent(name)}`);
  await expect(page.getByText('No patients found.')).toBeVisible();
});

test('deletes a course after typing its name', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const day = randomFutureDate();
  const name = uniqueName('Course to delete');
  const courseId = await seedCourse(api, { name, start: day, end: day });
  await login(page, TEST_USERS.organizer.email);
  await page.goto(`/courses/${courseId}`);
  await confirmDelete(page, 'course', name);
  await expect(page).toHaveURL(/\/courses$/);
  await expect(page.getByText(name)).toBeHidden();
});

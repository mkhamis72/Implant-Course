import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login, chooseImplant } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, seedImplantStock, seedRunningCourse } from './api';
import { withPg } from './companies';

// A course organizer places an implant as a doctor (Admin → Doctors), not as a delegate.

test.describe.configure({ mode: 'serial' });

const doctor = uniqueName('Dr Placer');
let brand = '';
let courseId = '';
let patientName = '';
let patientId = '';

test.afterAll(async () => {
  // Placed implants keep their doctor until the global teardown deletes the patient: deactivate if it is still referenced.
  await withPg(async (pg) => {
    try {
      await pg.query('delete from public.doctors where name = $1', [doctor]);
    } catch {
      await pg.query('update public.doctors set active = false where name = $1', [doctor]);
    }
  });
});

test('the admin adds a doctor', async ({ page }) => {
  test.setTimeout(180_000);
  const api = await apiAs(TEST_USERS.organizer.email);
  brand = uniqueName('DocBrand');
  await seedImplantStock(api, { brand, qty: 2, lot: `E2E-DOC${Date.now()}`, expiry: '2031-12-31' });
  courseId = await seedRunningCourse(api, uniqueName('Course'));

  await login(page, TEST_USERS.admin.email);
  await page.goto('/admin/doctors');
  await page.getByLabel('New doctor').fill(doctor);
  await page.getByRole('button', { name: 'Add doctor' }).click();
  await expect(page.getByRole('textbox', { name: 'Name' }).and(page.locator(`input[value="${doctor}"]`))).toBeVisible();
});

test('place an implant as a doctor', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, TEST_USERS.organizer.email);
  patientName = uniqueName('Doctor patient');
  patientId = await createPatientViaUi(page, { full_name: patientName });
  await page.getByRole('button', { name: 'Tooth 36, Present' }).click();
  const panel = page.getByRole('complementary', { name: 'Tooth details' });
  await panel.getByRole('button', { name: 'Place implant' }).click();
  await chooseImplant(page, brand, 'Ø4.0 × 10 mm');
  await page.getByRole('radiogroup', { name: 'Stock batch' }).getByRole('radio').first().check();
  await page.getByRole('combobox', { name: 'Course' }).selectOption(courseId);
  await expect(page.getByRole('radio', { name: 'Delegate' })).toBeChecked();
  await page.getByRole('radio', { name: 'Doctor' }).check();
  await expect(page.getByLabel('Placed by (delegate)')).toHaveCount(0);
  await page.getByRole('combobox', { name: /^Doctor/ }).selectOption({ label: doctor });
  await page.getByRole('combobox', { name: 'Technique' }).selectOption({ label: 'Free hand' });
  await page.getByRole('button', { name: 'Save placement' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 36, Implant placed' })).toBeVisible();

  await page.goto(`/patients/${patientId}?tooth=36`);
  await expect(panel.getByTestId('site-details')).toContainText(`Placed by ${doctor}`);
});

test('the course report still lists the implant', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  await page.goto(`/courses/${courseId}/report`);
  await expect(page.getByTestId('report-implant').filter({ hasText: patientName })).toHaveCount(1);
});

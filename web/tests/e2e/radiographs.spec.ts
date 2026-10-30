import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, seedDelegate, seedImplantStock, placeImplant } from './api';

test('records a full-mouth panorama without ticking teeth', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  const patientId = await createPatientViaUi(page, { full_name: uniqueName('Panorama patient') });
  await page.goto(`/patients/${patientId}/xrays`);
  await page.getByRole('button', { name: 'Add X-ray' }).click();
  await page.getByRole('combobox', { name: /^Type/ }).selectOption({ label: 'Panorama' });
  await page.getByRole('combobox', { name: /^Purpose/ }).selectOption({ label: 'Planning' });
  await expect(page.getByRole('radio', { name: 'Full mouth' })).toBeChecked();
  await page.getByRole('button', { name: 'Save X-ray' }).click();
  await expect(page.getByRole('button', { name: 'Save X-ray' })).toHaveCount(0);

  await page.reload();
  const card = page.getByTestId('xray');
  await expect(card).toContainText('Panorama');
  await expect(card).toContainText('Full mouth');
  await expect(card).not.toContainText('Teeth');
});

test('records an X-ray with a bone level, shows it on the implant, and removes it', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const stock = await seedImplantStock(api, { brand: uniqueName('Xray'), qty: 1, lot: `E2E-X${Date.now()}`, expiry: null });
  const delegate = await seedDelegate(api, uniqueName('Dr Xray'));
  await login(page, TEST_USERS.organizer.email);
  const patientId = await createPatientViaUi(page, { full_name: uniqueName('Xray patient') });
  const me = (await api.auth.getUser()).data.user!.id;
  const { error } = await placeImplant(api, {
    p_patient: patientId, p_tooth: 36, p_product: stock.productId, p_lot: stock.lotId,
    p_placed_on: new Date().toISOString().slice(0, 10), p_placing_delegate: delegate, p_supervisor: me,
  });
  expect(error).toBeNull();

  await page.goto(`/patients/${patientId}/xrays`);
  await page.getByRole('button', { name: 'Add X-ray' }).click();
  await page.getByRole('combobox', { name: /^Type/ }).selectOption({ label: 'Periapical' });
  await page.getByRole('combobox', { name: /^Purpose/ }).selectOption({ label: 'Baseline (after placement)' });
  await page.getByRole('checkbox', { name: '36' }).check();
  await page.getByLabel('Mesial 36').fill('0.5');
  await page.getByRole('button', { name: 'Save X-ray' }).click();
  await expect(page.getByRole('button', { name: 'Save X-ray' })).toHaveCount(0);

  await page.reload();
  const card = page.getByTestId('xray');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Baseline (after placement)');
  await expect(card).toContainText('0.5 mm');

  await page.goto(`/patients/${patientId}`);
  await page.getByRole('button', { name: 'Tooth 36, Implant placed' }).click();
  await page.getByRole('tab', { name: /^X-rays/ }).click();
  const toothCard = page.getByTestId('xray');
  await expect(toothCard).toHaveCount(1);
  await expect(toothCard).toContainText('0.5 mm');

  await toothCard.getByRole('button', { name: 'Remove' }).click();
  await toothCard.getByLabel('Reason for removing').fill('Wrong patient');
  await toothCard.getByRole('button', { name: 'Remove from record' }).click();
  await expect(page.getByText('No X-rays recorded for this tooth.')).toBeVisible();

  await page.goto(`/patients/${patientId}/xrays`);
  await expect(page.getByText('No X-rays recorded.')).toBeVisible();

  await page.goto(`/patients/${patientId}/history`);
  await expect(page.getByTestId('history-entry').filter({ hasText: 'X-ray removed from the record (Wrong patient)' })).toHaveCount(1);
});

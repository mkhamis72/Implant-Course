import { test, expect, type Page } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, seedDelegate, seedImplantStock } from './api';

const today = () => new Date().toISOString().slice(0, 10);

async function placedImplant(page: Page) {
  const api = await apiAs(TEST_USERS.organizer.email);
  const stock = await seedImplantStock(api, { brand: uniqueName('Comp'), qty: 1, lot: `E2E-C${Date.now()}`, expiry: null });
  const delegate = await seedDelegate(api, uniqueName('Dr Comp'));
  await login(page, TEST_USERS.organizer.email);
  const patientId = await createPatientViaUi(page, { full_name: uniqueName('Complication patient') });
  const me = (await api.auth.getUser()).data.user!.id;
  const { error } = await api.rpc('place_implant_v2', {
    p_patient: patientId, p_tooth: 36, p_product: stock.productId, p_lot: stock.lotId, p_placed_on: today(),
    p_placing_delegate: delegate, p_supervisor: me,
  });
  expect(error).toBeNull();
  return { patientId };
}
const panel = (page: Page) => page.getByRole('complementary', { name: 'Tooth details' });

test('adds and resolves a complication; the chart, Implants tab and History follow', async ({ page }) => {
  const { patientId } = await placedImplant(page);
  await page.goto(`/patients/${patientId}?tooth=36`);
  const box = panel(page).getByTestId('complications');
  await box.getByRole('button', { name: 'Add complication' }).click();
  await box.getByRole('combobox', { name: 'Category' }).selectOption('biological');
  await box.getByRole('combobox', { name: 'Type' }).selectOption('mucositis');
  await box.getByLabel('Noticed on').fill(today());
  await box.getByRole('button', { name: 'Save complication' }).click();
  await expect(box.getByText('Open')).toBeVisible();
  await expect(page.getByRole('button', { name: /Tooth 36, .*open complication/ })).toBeVisible();

  await page.goto(`/patients/${patientId}/implants`);
  await expect(page.getByTestId('open-complications')).toHaveText('1');

  await page.goto(`/patients/${patientId}?tooth=36`);
  await box.getByRole('button', { name: 'Edit complication' }).click();
  await box.getByLabel('Resolved on').fill(today());
  await box.getByRole('button', { name: 'Save complication' }).click();
  await expect(box.getByText('Resolved')).toBeVisible();
  await expect(page.getByRole('button', { name: /Tooth 36, .*open complication/ })).toHaveCount(0);

  await page.goto(`/patients/${patientId}/history`);
  await expect(page.getByText('Complication recorded: Peri-implant mucositis')).toBeVisible();
  await expect(page.getByText('Complication resolved: Peri-implant mucositis')).toBeVisible();
});

test('a failed visit records the failure; the failure box shows it and it can be edited', async ({ page }) => {
  const { patientId } = await placedImplant(page);
  await page.goto(`/patients/${patientId}?tooth=36`);
  await panel(page).getByRole('button', { name: 'Record visit' }).click();
  await panel(page).getByRole('combobox', { name: 'Outcome' }).selectOption('failed');
  await panel(page).getByRole('combobox', { name: 'Failure type' }).selectOption('removed');
  await panel(page).getByRole('combobox', { name: 'Failure reason' }).selectOption('malposition');
  await panel(page).getByRole('button', { name: 'Save visit' }).click();
  await expect(page.getByRole('button', { name: /Tooth 36, Failed implant/ })).toBeVisible();

  // The failed implant is now under "Earlier implants on this tooth".
  await panel(page).getByText(/Earlier implants on this tooth/).click();
  const failure = panel(page).getByTestId('failure');
  await expect(failure).toContainText('Removed · Malposition');
  await failure.getByRole('button', { name: 'Edit failure details' }).click();
  await failure.getByRole('combobox', { name: 'Failure reason' }).selectOption('fracture');
  await failure.getByRole('button', { name: 'Save failure details' }).click();
  await expect(failure).toContainText('Removed · Fracture');

  await page.goto(`/patients/${patientId}/history`);
  await expect(page.getByText(/failure recorded — Removed \(Malposition\)/)).toBeVisible();
  await expect(page.getByText(/failure details corrected: failure reason/)).toBeVisible();
});

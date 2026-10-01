import { test, expect, type Page } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, receiveStock, seedDelegate, seedImplantStock } from './api';

async function setup(page: Page) {
  const api = await apiAs(TEST_USERS.organizer.email);
  const brand = uniqueName('Implant');
  const lotNo = `E2E-${Date.now()}`;
  const stock = await seedImplantStock(api, { brand, qty: 3, lot: lotNo, expiry: '2031-12-31' });
  await receiveStock(api, stock.productId, 1, `${lotNo}-OLD`, '2020-01-01');
  const delegate = uniqueName('Dr Placer');
  await seedDelegate(api, delegate);
  await login(page, TEST_USERS.organizer.email);
  const patientId = await createPatientViaUi(page, { full_name: uniqueName('Implant patient') });
  return { api, brand, lotNo, delegate, patientId, ...stock };
}

function panel(page: Page) {
  return page.getByRole('complementary', { name: 'Tooth details' });
}

test('places an implant from the chart and deducts stock', async ({ page }) => {
  const s = await setup(page);
  await page.getByRole('button', { name: 'Tooth 36, Present' }).click();
  await panel(page).getByRole('button', { name: 'Place implant' }).click();
  await page.getByRole('combobox', { name: 'Implant', exact: true }).selectOption({ label: `${s.brand} E2E Ø4.0 × 10 mm` });
  const batch = page.getByLabel('Stock batch');
  await expect(batch.locator('option')).toHaveText(['Choose a batch…', `Lot ${s.lotNo} · exp 2031-12-31 · 3 left`]);
  await batch.selectOption({ index: 1 });
  await page.getByLabel('Placed by (delegate)').selectOption({ label: s.delegate });
  await page.getByLabel('Insertion torque (Ncm, optional)').fill('35');
  await page.getByRole('button', { name: 'Save placement' }).click();

  await expect(page.getByRole('button', { name: 'Tooth 36, Implant placed' })).toBeVisible();
  const details = panel(page).getByTestId('site-details');
  await expect(details).toContainText(s.delegate);
  await expect(details).toContainText('Test Organizer');
  await expect(details).toContainText(`Lot ${s.lotNo}`);
  await expect(details).toContainText('35 Ncm');

  await page.goto(`/inventory/lots/${s.lotId}`);
  await expect(page.getByTestId('on-hand')).toHaveText('2');
  await expect(page.getByTestId('usage-row')).toContainText(s.delegate);
});

test('plans an implant and cancels the plan', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Tooth 46, Present' }).click();
  await panel(page).getByRole('button', { name: 'Plan implant' }).click();
  await page.getByRole('button', { name: 'Save plan' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 46, Implant planned' })).toBeVisible();
  await panel(page).getByRole('button', { name: 'Cancel plan' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 46, Missing' })).toBeVisible();
});

test('missing fields are explained and nothing is saved', async ({ page }) => {
  const s = await setup(page);
  await page.getByRole('button', { name: 'Tooth 11, Present' }).click();
  await panel(page).getByRole('button', { name: 'Place implant' }).click();
  await page.getByRole('combobox', { name: 'Implant', exact: true }).selectOption({ label: `${s.brand} E2E Ø4.0 × 10 mm` });
  await page.getByRole('button', { name: 'Save placement' }).click();
  await expect(panel(page).getByRole('alert')).toHaveText('Choose a stock batch.');
  await expect(page.getByRole('button', { name: 'Tooth 11, Present' })).toBeVisible();
});

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
  const batch = page.getByRole('radiogroup', { name: 'Stock batch' });
  await expect(batch.getByRole('radio')).toHaveCount(1);
  await batch.getByRole('radio', { name: `Lot ${s.lotNo} · exp 2031-12-31 · 3 left` }).check();
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

async function seedComponent(api: Awaited<ReturnType<typeof apiAs>>, type: string, description: string, qty: number) {
  const brand = description.split(' ').slice(0, 3).join(' ');
  const productId = (await api.from('products').insert({ type, brand, system: 'E2E', description }).select('id').single()).data!.id as string;
  const lotId = await receiveStock(api, productId, qty, `${description.replace(/\s+/g, '-')}-LOT`, '2031-12-31');
  return { productId, lotId };
}

async function placeOn(page: Page, s: Awaited<ReturnType<typeof setup>>, tooth: number) {
  await page.getByRole('button', { name: `Tooth ${tooth}, Present` }).click();
  await panel(page).getByRole('button', { name: 'Place implant' }).click();
  await page.getByRole('combobox', { name: 'Implant', exact: true }).selectOption({ label: `${s.brand} E2E Ø4.0 × 10 mm` });
  await page.getByRole('radiogroup', { name: 'Stock batch' }).getByRole('radio').first().check();
  await page.getByLabel('Placed by (delegate)').selectOption({ label: s.delegate });
  await page.getByRole('button', { name: 'Save placement' }).click();
  await expect(page.getByRole('button', { name: `Tooth ${tooth}, Implant placed` })).toBeVisible();
}

test('fits a healing abutment then a Ti-base: badges change and stock is deducted', async ({ page }) => {
  const s = await setup(page);
  const ha = await seedComponent(s.api, 'healing_abutment', `${s.brand} HA`, 2);
  const tb = await seedComponent(s.api, 'ti_base', `${s.brand} TB`, 1);
  await placeOn(page, s, 36);

  await panel(page).getByRole('button', { name: 'Add component' }).click();
  await page.getByLabel('Product (optional)').selectOption({ label: `${s.brand} E2E · ${s.brand} HA` });
  await page.getByRole('radiogroup', { name: 'Stock batch' }).getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Save component' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 36, Implant placed, HA' })).toBeVisible();

  await panel(page).getByRole('button', { name: 'Add component' }).click();
  await page.getByRole('combobox', { name: 'Component', exact: true }).selectOption('ti_base');
  await page.getByLabel('Product (optional)').selectOption({ label: `${s.brand} E2E · ${s.brand} TB` });
  await page.getByRole('radiogroup', { name: 'Stock batch' }).getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Save component' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 36, Implant placed, TB' })).toBeVisible();
  await expect(panel(page).getByTestId('component-history')).toContainText('Healing abutment');
  await expect(panel(page).getByTestId('component-history')).toContainText('(current)');

  await page.goto(`/inventory/lots/${ha.lotId}`);
  await expect(page.getByTestId('on-hand')).toHaveText('1');
  await page.goto(`/inventory/lots/${tb.lotId}`);
  await expect(page.getByTestId('on-hand')).toHaveText('0');
});

test('a failed follow-up marks the tooth as a failed implant', async ({ page }) => {
  const s = await setup(page);
  await placeOn(page, s, 26);
  await panel(page).getByRole('button', { name: 'Add follow-up' }).click();
  await page.getByLabel('Check').fill('3-month');
  await page.getByLabel('Outcome').selectOption('failed');
  await page.getByLabel('Notes (optional)').fill('Mobile, removed');
  await page.getByRole('button', { name: 'Save follow-up' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 26, Failed implant' })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Place implant' })).toBeVisible();
  await expect(panel(page).getByText('Earlier implants on this tooth (1)')).toBeVisible();
});

test('a final restoration from the lab marks the tooth restored', async ({ page }) => {
  const s = await setup(page);
  await placeOn(page, s, 14);
  await panel(page).getByRole('button', { name: 'Add component' }).click();
  await page.getByRole('combobox', { name: 'Component', exact: true }).selectOption('final_restoration');
  await page.getByRole('button', { name: 'Save component' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 14, Restored, CR' })).toBeVisible();
});

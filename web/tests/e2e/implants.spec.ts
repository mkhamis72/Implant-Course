import { test, expect, type Page } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, receiveStock, seedDelegate, seedImplantStock, seedProduct } from './api';

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

/** Brand, then size (E2E products have the single line "E2E" and no type, so those fill in themselves). */
async function chooseImplant(page: Page, brand: string, size: string) {
  await page.getByRole('combobox', { name: 'Implant brand' }).selectOption({ label: brand });
  const sizes = page.getByRole('combobox', { name: 'Implant size' });
  const value = await sizes.locator('option', { hasText: size }).getAttribute('value');
  await sizes.selectOption(value!);
}

test('places an implant from the chart and deducts stock', async ({ page }) => {
  const s = await setup(page);
  await page.getByRole('button', { name: 'Tooth 36, Present' }).click();
  await panel(page).getByRole('button', { name: 'Place implant' }).click();
  await chooseImplant(page, s.brand, 'Ø4.0 × 10 mm');
  const batch = page.getByRole('radiogroup', { name: 'Stock batch' });
  await expect(batch.getByRole('radio')).toHaveCount(1);
  await batch.getByRole('radio', { name: `Lot ${s.lotNo} · exp 2031-12-31 · 3 left` }).check();
  await page.getByLabel('Placed by (delegate)').selectOption({ label: s.delegate });
  await page.getByRole('combobox', { name: 'Technique' }).selectOption({ label: 'Free hand' });
  await page.getByRole('button', { name: 'Save placement' }).click();

  await expect(page.getByRole('button', { name: 'Tooth 36, Implant placed' })).toBeVisible();
  // Stability is recorded in Surgical details, which opens after placement.
  const surgical = panel(page).getByTestId('surgical-details');
  await surgical.getByRole('button', { name: 'Edit surgical details' }).click();
  await surgical.getByLabel('Insertion torque (Ncm, optional)').fill('35');
  await surgical.getByRole('combobox', { name: 'Bone type' }).selectOption('D2');
  await surgical.getByRole('button', { name: 'Save surgical details' }).click();
  await expect(surgical.getByRole('button', { name: 'Edit surgical details' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Tooth 36, Implant placed' }).click();
  await panel(page).getByRole('tab', { name: 'Implant' }).click();
  const details = panel(page).getByTestId('site-details');
  await expect(details).toContainText(s.delegate);
  await expect(details).toContainText('Test Organizer');
  await expect(details).toContainText(`Lot ${s.lotNo}`);
  await expect(details).toContainText('35 Ncm');
  await expect(details).toContainText('Bone D2');
  await expect(details.getByTestId('technique')).toContainText('Free hand');

  await page.goto(`/inventory/lots/${s.lotId}`);
  await expect(page.getByTestId('on-hand')).toHaveText('2');
  await expect(page.getByTestId('usage-row')).toContainText(s.delegate);
});

test('plans an implant and cancels the plan', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Tooth 46, Present' }).click();
  await panel(page).getByRole('button', { name: 'Plan implant' }).click();
  await page.getByRole('combobox', { name: 'Technique' }).selectOption({ label: 'Free hand' });
  await page.getByRole('button', { name: 'Save plan' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 46, Implant planned' })).toBeVisible();
  await panel(page).getByRole('button', { name: 'Cancel plan' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 46, Missing' })).toBeVisible();
});

test('missing fields are explained and nothing is saved', async ({ page }) => {
  const s = await setup(page);
  await page.getByRole('button', { name: 'Tooth 11, Present' }).click();
  await panel(page).getByRole('button', { name: 'Place implant' }).click();
  await chooseImplant(page, s.brand, 'Ø4.0 × 10 mm');
  await page.getByRole('combobox', { name: 'Technique' }).selectOption({ label: 'Free hand' });
  await page.getByRole('button', { name: 'Save placement' }).click();
  await expect(panel(page).getByRole('alert')).toHaveText('Choose a stock batch.');
  await expect(page.getByRole('button', { name: 'Tooth 11, Present' })).toBeVisible();
});

test('receives a missing size inside the placement form without losing what was typed', async ({ page }) => {
  const s = await setup(page);
  const productId = await seedProduct(s.api, { type: 'implant', brand: s.brand, diameter_mm: 5, length_mm: 13 });
  await page.reload(); // the chart was loaded before this product existed
  await page.getByRole('button', { name: 'Tooth 37, Present' }).click();
  await panel(page).getByRole('button', { name: 'Place implant' }).click();
  await page.getByLabel('Placed by (delegate)').selectOption({ label: s.delegate });
  await page.getByRole('combobox', { name: 'Technique' }).selectOption({ label: 'Free hand' });
  await page.getByLabel('Notes (optional)').fill('Typed before receiving');

  // "In stock only" hides the new size until it is unticked.
  await page.getByRole('combobox', { name: 'Implant brand' }).selectOption({ label: s.brand });
  await expect(page.getByRole('combobox', { name: 'Implant size' }).locator('option', { hasText: 'Ø5.0 × 13 mm' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'In stock only' }).uncheck();
  await chooseImplant(page, s.brand, 'Ø5.0 × 13 mm');
  await expect(panel(page).getByText('No usable stock for this product.')).toBeVisible();

  const lotNo = `E2E-IN-${Date.now()}`;
  await page.getByRole('button', { name: 'Receive stock here' }).click();
  const box = page.getByRole('group', { name: 'Receive stock' });
  await box.getByLabel('Quantity').fill('5');
  await box.getByLabel('Lot number (optional)').fill(lotNo);
  await box.getByRole('button', { name: 'Receive' }).click();
  // Wait for the refreshed chart: the new batch is listed and already selected.
  await expect(page.getByRole('radiogroup', { name: 'Stock batch' }).getByRole('radio', { name: new RegExp(`Lot ${lotNo}`) })).toBeChecked();
  await expect(page.getByLabel('Notes (optional)')).toHaveValue('Typed before receiving');
  await expect(page.getByLabel('Placed by (delegate)')).toHaveValue(/.+/);

  await page.getByRole('button', { name: 'Save placement' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 37, Implant placed' })).toBeVisible();
  await expect(panel(page).getByTestId('site-details')).toContainText(`Lot ${lotNo}`);
  const { data } = await s.api.from('stock_on_hand').select('on_hand').eq('product_id', productId).single();
  expect(data?.on_hand).toBe(4);
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
  await chooseImplant(page, s.brand, 'Ø4.0 × 10 mm');
  await page.getByRole('radiogroup', { name: 'Stock batch' }).getByRole('radio').first().check();
  await page.getByLabel('Placed by (delegate)').selectOption({ label: s.delegate });
  await page.getByRole('combobox', { name: 'Technique' }).selectOption({ label: 'Free hand' });
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
  await panel(page).getByRole('button', { name: 'Record visit' }).click();
  await panel(page).getByRole('combobox', { name: 'Outcome' }).selectOption('failed');
  await panel(page).getByRole('combobox', { name: 'Failure type' }).selectOption('removed');
  await panel(page).getByRole('combobox', { name: 'Failure reason' }).selectOption('other');
  // the surgical details block above also has a Notes field
  const visitForm = panel(page).locator('form').filter({ has: page.getByRole('button', { name: 'Save visit' }) });
  await visitForm.getByLabel('Notes', { exact: true }).fill('Mobile, removed');
  await panel(page).getByRole('button', { name: 'Save visit' }).click();
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

test('records a digital scan and finds the patient by it', async ({ page }) => {
  const s = await setup(page);
  const name = (await page.getByRole('heading', { level: 1 }).first().innerText()).trim();
  await placeOn(page, s, 36);
  await panel(page).getByRole('tab', { name: 'Implant' }).click();
  const impression = panel(page).getByTestId('impression');
  await impression.getByRole('combobox', { name: 'Scan / impression' }).selectOption({ label: 'Digital scan' });
  await impression.getByRole('button', { name: 'Save' }).click();
  await expect(impression).toContainText('Digital scan');

  await page.goto(`/patients?stage=digital_scan&q=${encodeURIComponent(name)}`);
  await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible();
  await page.goto(`/patients?stage=impression_pending&q=${encodeURIComponent(name)}`);
  await expect(page.getByRole('row', { name: new RegExp(name) })).toHaveCount(0);
});

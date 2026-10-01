import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { uniqueName } from './patients';
import { apiAs, receiveStock, seedProduct } from './api';

test.beforeEach(async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
});

test('the sample catalog is visible and flagged', async ({ page }) => {
  await page.goto('/inventory?all=1&q=Straumann%20BLX');
  await expect(page.getByRole('main')).toContainText('Straumann BLX Ø4.0 × 10 mm');
  await expect(page.getByRole('main').getByText('Sample — verify').first()).toBeVisible();
});

test('adds a product and edits its reorder level', async ({ page }) => {
  const brand = uniqueName('Brand');
  await page.getByRole('link', { name: 'Inventory' }).click();
  await page.getByRole('link', { name: 'Add product' }).click();
  await page.getByLabel('Type').selectOption('implant');
  await page.getByLabel('Brand').fill(brand);
  await page.getByLabel('System').fill('X1');
  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Implants need a diameter and a length.');
  await expect(page.getByLabel('Brand')).toHaveValue(brand);
  await page.getByLabel('Diameter (mm)').fill('4.1');
  await page.getByLabel('Length (mm)').fill('10');
  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${brand} X1 Ø4.1 × 10 mm`);
  await page.getByLabel('Reorder level').fill('5');
  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(page.getByText('Product saved.')).toBeVisible();
});

test('stock overview shows on hand, low stock and expiring flags', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const brand = uniqueName('Stock');
  const product = await seedProduct(api, { type: 'healing_abutment', brand, description: 'HA 5 mm' });
  await api.from('products').update({ reorder_level: 5 }).eq('id', product);
  const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  await receiveStock(api, product, 3, 'EXP-SOON', soon);
  await page.goto(`/inventory?q=${encodeURIComponent(brand)}`);
  const row = page.getByTestId(`stock-row-${product}`);
  await expect(row).toContainText('3');
  await expect(row).toContainText('Low stock');
  await expect(row).toContainText('Expiring');
});

test('receives stock, adjusts it and shows the ledger', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const brand = uniqueName('Receive');
  const product = await seedProduct(api, { type: 'ti_base', brand });
  const lotNo = `E2E-L${Date.now()}`;

  await page.goto(`/inventory/receive?product=${product}`);
  await page.getByLabel('Quantity').fill('5');
  await page.getByLabel('Lot number (optional)').fill(lotNo);
  await page.getByLabel('Expiry (optional)').fill('2031-06-30');
  await page.getByRole('button', { name: 'Receive' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Lot ${lotNo}`);
  await expect(page.getByTestId('on-hand')).toHaveText('5');

  await page.getByLabel('Reason').selectOption('waste');
  await page.getByLabel('Quantity').fill('1');
  await page.getByLabel('Note').fill('Dropped during surgery');
  await page.getByRole('button', { name: 'Record change' }).click();
  await expect(page.getByTestId('on-hand')).toHaveText('4');
  await expect(page.getByTestId('ledger-row')).toHaveCount(2);
  await expect(page.getByTestId('ledger-row').first()).toContainText('Wasted');
  await expect(page.getByTestId('ledger-row').first()).toContainText('-1');

  await page.getByLabel('Reason').selectOption('return');
  await page.getByLabel('Quantity').fill('9');
  await page.getByLabel('Note').fill('Back to supplier');
  await page.getByRole('button', { name: 'Record change' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Only 4 left in this batch.');

  await page.getByRole('link', { name: 'Recall lookup' }).click();
  await page.getByLabel('Lot number').fill(lotNo.toLowerCase());
  await page.getByRole('button', { name: 'Find' }).click();
  await expect(page.getByRole('link', { name: lotNo })).toBeVisible();
});

test('a batch can be received without a lot number', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const product = await seedProduct(api, { type: 'cover_screw', brand: uniqueName('NoLot') });
  await page.goto(`/inventory/receive?product=${product}`);
  await page.getByLabel('Quantity').fill('2');
  await page.getByRole('button', { name: 'Receive' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('No lot number');
  await expect(page.getByTestId('on-hand')).toHaveText('2');
});

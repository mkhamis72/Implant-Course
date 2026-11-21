import { test, expect, type Page } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { uniqueName } from './patients';
import { apiAs, seedProduct } from './api';

// Admin → Catalogue (0128). The round trip uses a hand-entered product with a brand unique to the test, so the shared
// Oxy library is never switched off for other specs.

async function save(page: Page) {
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toContainText(/Saved: \d+ switched on, \d+ switched off\./);
}

test('an admin switches a product off and on; the booking form follows', async ({ page }) => {
  test.slow(); // three pages, each compiled on first use by the dev server
  const api = await apiAs(TEST_USERS.admin.email);
  const brand = uniqueName('Catalogue');
  const productId = await seedProduct(api, { type: 'implant', brand, diameter_mm: 4, length_mm: 10 });
  const label = `${brand} E2E Ø4.0 × 10 mm`;

  await login(page, TEST_USERS.admin.email);
  await page.goto('/admin/catalogue');
  await expect(page.getByRole('heading', { name: 'Catalogue' })).toBeVisible();
  // The shared library is there, grouped by system.
  await page.getByRole('searchbox', { name: 'Find' }).fill('PSK Normo');
  await expect(page.getByRole('checkbox', { name: 'PSK-MDK · PSK Normo' })).toBeVisible();

  await page.getByRole('searchbox', { name: 'Find' }).fill(brand);
  const own = page.getByRole('checkbox', { name: label });
  await expect(own).toBeChecked();
  await own.uncheck();
  await save(page);
  await page.reload();
  await page.getByRole('searchbox', { name: 'Find' }).fill(brand);
  await expect(page.getByRole('checkbox', { name: label })).not.toBeChecked();

  await page.goto('/schedule/new');
  await expect(page.getByRole('combobox', { name: 'Implant 1' }).locator(`option[value="${productId}"]`)).toHaveCount(0);

  await page.goto('/admin/catalogue');
  await page.getByRole('searchbox', { name: 'Find' }).fill(brand);
  await page.getByRole('checkbox', { name: label }).check();
  await save(page);
  await page.goto('/schedule/new');
  await expect(page.getByRole('combobox', { name: 'Implant 1' }).locator(`option[value="${productId}"]`)).toHaveCount(1);
});

test('a product from the library keeps its catalogue fields; its reorder level can change', async ({ page }) => {
  const api = await apiAs(TEST_USERS.admin.email);
  const { data, error } = await api.from('products').select('id, reorder_level')
    .not('catalog_item_id', 'is', null).eq('type', 'implant').order('ref_code').limit(1).single();
  if (error) throw error;
  const before = String(data.reorder_level);
  const next = before === '7' ? '8' : '7';

  await login(page, TEST_USERS.admin.email);
  await page.goto(`/inventory/products/${data.id}`);
  await expect(page.getByText('From the catalogue library.')).toBeVisible();
  await expect(page.getByLabel('Brand')).toBeDisabled();
  try {
    await page.getByLabel('Reorder level').fill(next);
    await page.getByRole('button', { name: 'Save product' }).click();
    await expect(page.getByText('Product saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Reorder level')).toHaveValue(next);
  } finally {
    await api.from('products').update({ reorder_level: Number(before) }).eq('id', data.id);
  }
});

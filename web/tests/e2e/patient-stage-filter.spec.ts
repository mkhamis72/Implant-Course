import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { uniqueName } from './patients';
import { apiAs, receiveStock, seedDelegate, seedImplantStock, seedProduct, placeImplant } from './api';

async function seedPatient(api: SupabaseClient, full_name: string): Promise<string> {
  const { data, error } = await api.from('patients').insert({ full_name }).select('id').single();
  if (error) throw error;
  return data.id;
}

test('filters patients by implant stage and shows the matching teeth', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const me = (await api.auth.getUser()).data.user!.id;
  const tag = uniqueName('Stage');
  const stock = await seedImplantStock(api, { brand: tag, qty: 2, lot: `E2E-S${Date.now()}`, expiry: null });
  const delegate = await seedDelegate(api, `${tag} Dr`);
  const today = new Date().toISOString().slice(0, 10);

  const placeWith = async (name: string, tooth: number, component: string) => {
    const patient = await seedPatient(api, name);
    const { data: site, error } = await placeImplant(api, {
      p_patient: patient, p_tooth: tooth, p_product: stock.productId, p_lot: stock.lotId,
      p_placed_on: today, p_placing_delegate: delegate, p_supervisor: me,
    });
    expect(error).toBeNull();
    const product = await seedProduct(api, { type: component, brand: tag });
    const lot = await receiveStock(api, product, 1, null, null);
    const fit = await api.rpc('fit_component', {
      p_site: site, p_type: component, p_fitted_on: today, p_product: product, p_lot: lot, p_by_delegate: delegate,
    });
    expect(fit.error).toBeNull();
  };
  await placeWith(`${tag} Healing`, 36, 'healing_abutment');
  await placeWith(`${tag} Cover`, 46, 'cover_screw');

  await login(page, TEST_USERS.organizer.email);
  await page.goto('/patients');
  await page.getByLabel('Search patients').fill(tag);
  await page.getByLabel('Placed · healing abutment').check();
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/stage=healing_abutment/);
  const rows = page.getByRole('row').filter({ hasText: tag });
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(`${tag} Healing`);
  await expect(rows.first()).toContainText('36 Placed·HA');

  await page.getByLabel('Placed · cover screw').check();
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/stage=cover_screw/);
  await expect(rows).toHaveCount(2);
});

test('filters patients by missing and to-be-extracted teeth, ORed with the other boxes', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const tag = uniqueName('Teeth');
  const missing = await seedPatient(api, `${tag} Missing`);
  const extract = await seedPatient(api, `${tag} Extract`);
  await seedPatient(api, `${tag} Healthy`);
  const states = await api.from('tooth_status').insert([
    { patient_id: missing, tooth: 14, status: 'missing' },
    { patient_id: extract, tooth: 47, status: 'extracted' },
  ]);
  expect(states.error).toBeNull();

  await login(page, TEST_USERS.organizer.email);
  await page.goto('/patients');
  await expect(page.getByLabel('Prosthetic stage')).toHaveCount(0);
  await page.getByLabel('Search patients').fill(tag);
  await page.getByLabel('Missing').check();
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/stage=missing/);
  const rows = page.getByRole('row').filter({ hasText: tag });
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('14 Missing');

  await page.getByLabel('To be extracted').check();
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/stage=extracted/);
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: `${tag} Extract` })).toContainText('47 To extract');
});

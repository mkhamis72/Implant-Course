import { test, expect, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { uniqueName } from './patients';
import { apiAs, receiveStock, seedDelegate, seedImplantStock, seedProduct, seedRunningCourse, placeImplant } from './api';

async function seedPatient(api: SupabaseClient, full_name: string): Promise<string> {
  const { data, error } = await api.from('patients').insert({ full_name }).select('id').single();
  if (error) throw error;
  return data.id;
}

/** The stage boxes sit in compact dropdowns on the search row (open it before ticking). */
async function openMenu(page: Page, label: string) {
  await page.locator('summary', { hasText: label }).click();
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
    const fit = await api.rpc('fit_component_v4', { p_screw_size: null,
      p_site: site, p_type: component, p_fitted_on: today, p_product: product, p_lot: lot, p_by_delegate: delegate,
      p_by_organizer: null, p_notes: '', p_course: null, p_torque: null, p_holds_component: null, p_holds_restoration: null,
    });
    expect(fit.error).toBeNull();
  };
  await placeWith(`${tag} Healing`, 36, 'healing_abutment');
  await placeWith(`${tag} Cover`, 46, 'cover_screw');

  await login(page, TEST_USERS.organizer.email);
  await page.goto('/patients');
  await page.getByLabel('Search patients').fill(tag);
  await openMenu(page, 'Teeth and implants');
  await page.getByLabel('Placed · healing abutment').check();
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/stage=healing_abutment/);
  const rows = page.getByRole('row').filter({ hasText: tag });
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(`${tag} Healing`);
  await expect(rows.first()).toContainText('36 Placed·HA');

  await openMenu(page, 'Teeth and implants');
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
  await openMenu(page, 'Teeth and implants');
  await page.getByRole('checkbox', { name: 'Missing', exact: true }).check();
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/stage=missing/);
  const rows = page.getByRole('row').filter({ hasText: tag });
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('14 Missing');

  await openMenu(page, 'Teeth and implants');
  await page.getByRole('checkbox', { name: 'To be extracted', exact: true }).check();
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/stage=extracted/);
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: `${tag} Extract` })).toContainText('47 To extract');
});

test('filters patients by course and by supervisor from the dropdowns', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const me = (await api.auth.getUser()).data.user!.id;
  const tag = uniqueName('Course');
  const stock = await seedImplantStock(api, { brand: tag, qty: 2, lot: `E2E-C${Date.now()}`, expiry: null });
  const delegate = await seedDelegate(api, `${tag} Dr`);
  const today = new Date().toISOString().slice(0, 10);
  const courseA = `${tag} Course A`;
  const courseAId = await seedRunningCourse(api, courseA);
  const courseBId = await seedRunningCourse(api, `${tag} Course B`);
  for (const [name, course] of [[`${tag} In A`, courseAId], [`${tag} In B`, courseBId]] as const) {
    const patient = await seedPatient(api, name);
    const { error } = await placeImplant(api, {
      p_patient: patient, p_tooth: 36, p_product: stock.productId, p_lot: stock.lotId,
      p_placed_on: today, p_placing_delegate: delegate, p_supervisor: me, p_course: course,
    });
    expect(error).toBeNull();
  }

  await login(page, TEST_USERS.organizer.email);
  await page.goto('/patients');
  await page.getByLabel('Search patients').fill(tag);
  await page.getByRole('combobox', { name: 'Course', exact: true }).selectOption({ label: courseA });
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(new RegExp(`course=${courseAId}`));
  const rows = page.getByRole('row').filter({ hasText: tag });
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(`${tag} In A`);
  await expect(page.getByRole('combobox', { name: 'Course', exact: true })).toHaveValue(courseAId);

  await page.getByRole('combobox', { name: 'Course', exact: true }).selectOption('');
  await page.getByRole('combobox', { name: 'Supervisor', exact: true }).selectOption(me);
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(new RegExp(`supervisor=${me}`));
  await expect(rows).toHaveCount(2);
});

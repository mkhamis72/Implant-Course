// Runs in the "phone" project only (see playwright.config.ts).
import { test, expect, type Page } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, seedDelegate, seedImplantStock } from './api';

// The narrowest common phone width, stricter than the Pixel 7 default.
test.use({ viewport: { width: 360, height: 780 } });

async function expectNoSideways(page: Page) {
  // Mobile browsers widen the layout viewport to fit oversized content, so compare with the device width.
  const contentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(contentWidth, `${page.url()} scrolls sideways`).toBeLessThanOrEqual(page.viewportSize()!.width);
}

test('the menu opens, navigates and closes on a phone', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Patients' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Patients' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
});

test('main pages fit the phone screen without sideways scrolling', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  for (const path of ['/', '/patients', '/schedule', '/inventory', '/checklists', '/courses', '/delegates', '/account/security',
    '/schedule/new', '/inventory/receive', '/inventory/recall', '/checklists/templates', '/patients/new']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoSideways(page);
  }
});

test('a checklist can be created and ticked on a phone', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  await page.goto('/checklists');
  const title = uniqueName('Phone list');
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Items (one per line)').fill('Gloves\nGowns');
  await page.getByRole('button', { name: 'Create checklist' }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expectNoSideways(page);
  await page.getByRole('checkbox', { name: 'Gowns' }).check();
  await expect(page.getByTestId('checklist-progress')).toHaveText('1/2 done');
});

test('the menu takes keyboard focus while open and gives it back on close', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  const menu = page.getByRole('button', { name: 'Menu' });
  await menu.click();
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link').first()).toBeFocused();
  await expect(page.locator('main')).toHaveAttribute('inert', '');
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await expect(page.locator('main')).not.toHaveAttribute('inert', '');
});

test('the medical history risk factors fit a phone screen', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  const id = await createPatientViaUi(page, { full_name: uniqueName('Phone history') });
  await page.goto(`/patients/${id}/overview`);
  await expect(page.getByRole('radiogroup', { name: 'Previous implant failure' })).toBeVisible();
  await expectNoSideways(page);
});

test('the visit form and its probing grid fit a phone screen', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const stock = await seedImplantStock(api, { brand: uniqueName('Phone visit'), qty: 1, lot: `E2E-PV${Date.now()}`, expiry: null });
  const delegate = await seedDelegate(api, uniqueName('Dr Phone'));
  await login(page, TEST_USERS.organizer.email);
  const id = await createPatientViaUi(page, { full_name: uniqueName('Phone visit') });
  const me = (await api.auth.getUser()).data.user!.id;
  const { error } = await api.rpc('place_implant_v2', {
    p_patient: id, p_tooth: 36, p_product: stock.productId, p_lot: stock.lotId,
    p_placed_on: new Date().toISOString().slice(0, 10), p_placing_delegate: delegate, p_supervisor: me, p_technique: 'guided',
  });
  expect(error).toBeNull();
  await page.goto(`/patients/${id}?tooth=36`);
  await page.getByRole('button', { name: 'Record visit' }).click();
  await expect(page.getByLabel('Probing depth lingual')).toBeVisible();
  await expectNoSideways(page);
});

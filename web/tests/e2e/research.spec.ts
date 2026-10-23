import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, seedDelegate, seedImplantStock, placeImplant } from './api';

const today = () => new Date().toISOString().slice(0, 10);

test('the research page counts placed implants, drills down to the patients, and refuses an organizer without Research', async ({ page, browser }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const brand = uniqueName('Res');
  const stock = await seedImplantStock(api, { brand, qty: 2, lot: `E2E-RS${Date.now()}`, expiry: null });
  const delegate = await seedDelegate(api, uniqueName('Dr Res'));
  const me = (await api.auth.getUser()).data.user!.id;

  await login(page, TEST_USERS.organizer.email);
  const names: string[] = [];
  for (const tooth of [36, 46]) {
    const name = uniqueName('Research patient');
    names.push(name);
    const patientId = await createPatientViaUi(page, { full_name: name });
    const placed = await placeImplant(api, {
      p_patient: patientId, p_tooth: tooth, p_product: stock.productId, p_lot: stock.lotId, p_placed_on: today(),
      p_placing_delegate: delegate, p_supervisor: me,
    });
    expect(placed.error).toBeNull();
  }

  // The test organizer has no Research permission: refused.
  await page.goto('/patients/research');
  await expect(page).not.toHaveURL(/\/patients\/research/);
  await expect(page.getByRole('heading', { level: 1, name: 'Research' })).toHaveCount(0);

  const adminCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();
  try {
    await login(adminPage, TEST_USERS.admin.email);
    await adminPage.goto(`/patients/research?brand=${encodeURIComponent(brand)}`);
    await expect(adminPage.getByRole('heading', { level: 1, name: 'Research' })).toBeVisible();
    const tile = adminPage.locator('a[href*="list=implants"]').first();
    await expect(tile).toHaveText('2');

    await tile.click();
    await expect(adminPage).toHaveURL(/\/patients\/research\/drilldown\?list=implants/);
    for (const name of names) await expect(adminPage.getByText(name).first()).toBeVisible();
  } finally {
    await adminCtx.close();
  }
});

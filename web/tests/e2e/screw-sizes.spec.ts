import { test, expect, type Page } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login, chooseImplant } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, enroll, receiveStock, seedDelegate, seedImplantStock, seedProduct, seedRunningCourse } from './api';

function panel(page: Page) {
  return page.getByRole('complementary', { name: 'Tooth details' });
}

test('fits an abutment screw with a size: the screwdriver shows, and the size is on the chart', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const admin = await apiAs(TEST_USERS.admin.email);
  const brand = uniqueName('Implant');
  await seedImplantStock(api, { brand, qty: 2, lot: `E2E-${Date.now()}`, expiry: '2031-12-31' });
  const mua = await seedProduct(api, { type: 'multi_unit', brand, system: 'E2E', description: `${brand} MUA` });
  await receiveStock(api, mua, 1, `${brand}-MUA`, '2031-12-31');
  const sizeLabel = `M1.6 x ${Date.now() % 1000}`;
  const { error } = await admin.rpc('save_screw_size', {
    p_id: null, p_brand: brand, p_system: 'E2E', p_kind: 'abutment_screw', p_label: sizeLabel,
    p_driver_interface: 'Hex', p_driver_size: '1.25', p_driver_ref: null, p_torque: 25,
  });
  expect(error).toBeNull();
  const delegate = uniqueName('Dr Placer');
  const delegateId = await seedDelegate(api, delegate);
  const courseId = await seedRunningCourse(api, uniqueName('Course'));
  await enroll(api, courseId, delegateId);
  await login(page, TEST_USERS.organizer.email);
  await createPatientViaUi(page, { full_name: uniqueName('Screw patient') });

  await page.getByRole('button', { name: 'Tooth 36, Present' }).click();
  await panel(page).getByRole('button', { name: 'Place implant' }).click();
  await chooseImplant(page, brand, 'Ø4.0 × 10 mm');
  await page.getByRole('radiogroup', { name: 'Stock batch' }).getByRole('radio').first().check();
  await page.getByRole('combobox', { name: 'Course' }).selectOption(courseId);
  await page.getByLabel('Placed by (delegate)').selectOption({ label: delegate });
  await page.getByRole('combobox', { name: 'Technique' }).selectOption({ label: 'Free hand' });
  await page.getByRole('button', { name: 'Save placement' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 36, Implant placed' })).toBeVisible();

  await panel(page).getByRole('tab', { name: 'Implant' }).click();
  await panel(page).getByRole('button', { name: 'Add component' }).click();
  await page.getByRole('combobox', { name: 'Component', exact: true }).selectOption('multi_unit');
  await page.getByLabel('Product (optional)').selectOption(mua);
  await page.getByRole('radiogroup', { name: 'Stock batch' }).getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Save component' }).click();
  await expect(panel(page).getByTestId('current-part')).toHaveCount(1);

  await panel(page).getByRole('button', { name: 'Add component' }).click();
  await page.getByRole('combobox', { name: 'Component', exact: true }).selectOption('abutment_screw');
  const holds = page.getByRole('combobox', { name: 'Holds' });
  const value = await holds.locator('option').filter({ hasText: /^Multi-unit abutment/ }).getAttribute('value');
  await holds.selectOption(value!);
  await page.getByRole('combobox', { name: 'Size' }).selectOption({ label: sizeLabel });
  await expect(page.getByTestId('size-driver')).toContainText('Screwdriver Hex 1.25');
  await expect(page.getByTestId('size-driver')).toContainText('Recommended torque 25 Ncm');
  await page.getByRole('button', { name: 'Save component' }).click();

  await expect(panel(page).getByTestId('current-part')).toHaveCount(2);
  await page.reload();
  await page.getByRole('button', { name: /^Tooth 36, Implant placed/ }).click();
  await panel(page).getByRole('tab', { name: 'Implant' }).click();
  await expect(panel(page).getByTestId('current-part').filter({ hasText: 'Abutment screw' })).toContainText(`Size ${sizeLabel}`);
});

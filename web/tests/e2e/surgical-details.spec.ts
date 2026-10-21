import { test, expect, type Page } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, seedDelegate, seedImplantStock } from './api';

async function placedImplant(page: Page) {
  const api = await apiAs(TEST_USERS.organizer.email);
  const stock = await seedImplantStock(api, { brand: uniqueName('Surg'), qty: 1, lot: `E2E-S${Date.now()}`, expiry: null });
  const delegate = await seedDelegate(api, uniqueName('Dr Surg'));
  await login(page, TEST_USERS.organizer.email);
  const patientId = await createPatientViaUi(page, { full_name: uniqueName('Surgery patient') });
  const me = (await api.auth.getUser()).data.user!.id;
  const { error } = await api.rpc('place_implant_v2', {
    p_patient: patientId, p_tooth: 36, p_product: stock.productId, p_lot: stock.lotId,
    p_placed_on: new Date().toISOString().slice(0, 10), p_placing_delegate: delegate, p_supervisor: me,
  });
  expect(error).toBeNull();
  return { patientId };
}

test('records surgical details and a graft; Implants tab and History follow', async ({ page }) => {
  const { patientId } = await placedImplant(page);
  await page.goto(`/patients/${patientId}?tooth=36`);
  const panel = page.getByRole('complementary', { name: 'Tooth details' });
  const box = panel.getByTestId('surgical-details');
  const tab = panel.getByRole('tab', { name: /Surgical details/ });
  await expect(tab).toHaveAccessibleName('Surgical details 0 of 12 recorded');
  await tab.click();

  await box.getByRole('button', { name: 'Edit surgical details' }).click();
  await box.getByRole('combobox', { name: 'Placement timing' }).selectOption('delayed');
  await box.getByLabel('Extraction date').fill('2025-01-15');
  await box.getByRole('combobox', { name: 'Soft-tissue phenotype' }).selectOption('thick');
  await box.getByLabel('Keratinized mucosa (mm)').fill('3');
  await box.getByRole('combobox', { name: 'Flap' }).selectOption('crestal');
  await box.getByLabel('Insertion torque (Ncm, optional)').fill('35');
  await box.getByLabel('ISQ (optional)').fill('72');
  await box.getByRole('combobox', { name: 'Bone type' }).selectOption('D2');
  await box.getByRole('combobox', { name: 'Torque measured as' }).selectOption('peak');
  await box.getByRole('combobox', { name: 'Healing' }).selectOption('submerged');
  await box.getByRole('combobox', { name: 'Primary closure' }).selectOption('yes');
  await box.getByRole('combobox', { name: 'Grafting performed' }).selectOption('yes');
  await box.getByRole('button', { name: 'Save surgical details' }).click();
  await expect(tab).toHaveAccessibleName('Surgical details 12 of 12 recorded');
  await expect(box).toContainText('Grafting is marked as performed, but no graft is recorded.');

  await box.getByRole('button', { name: 'Add graft' }).click();
  await box.getByRole('combobox', { name: 'Procedure' }).selectOption('gbr');
  await box.getByRole('combobox', { name: 'Graft timing' }).selectOption('simultaneous');
  await box.getByRole('combobox', { name: 'Material' }).selectOption('xenograft');
  await box.getByRole('combobox', { name: 'Membrane' }).selectOption('resorbable');
  await box.getByRole('button', { name: 'Save graft' }).click();
  await expect(box.getByTestId('grafts')).toContainText('GBR · Xenograft · Resorbable membrane · Simultaneous');
  await expect(box).not.toContainText('no graft is recorded');

  await page.goto(`/patients/${patientId}/implants`);
  await expect(page.getByTestId('details-completeness')).toHaveText('12/12');

  await page.goto(`/patients/${patientId}/history`);
  await expect(page.getByText('Surgical details recorded')).toBeVisible();
  await expect(page.getByText('Graft added: GBR')).toBeVisible();
});

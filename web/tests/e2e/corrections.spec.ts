import { test, expect, type Page } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, receiveStock, seedDelegate, seedImplantStock } from './api';

async function placedImplant(page: Page) {
  const api = await apiAs(TEST_USERS.organizer.email);
  const brand = uniqueName('Fix');
  const wrong = `E2E-W${Date.now()}`;
  const right = `E2E-R${Date.now()}`;
  const stock = await seedImplantStock(api, { brand, qty: 2, lot: wrong, expiry: null });
  const rightLot = await receiveStock(api, stock.productId, 2, right, null);
  const delegate = await seedDelegate(api, uniqueName('Dr Fix'));
  await login(page, TEST_USERS.organizer.email);
  const patientId = await createPatientViaUi(page, { full_name: uniqueName('Fix patient') });
  const me = (await api.auth.getUser()).data.user!.id;
  const { data: siteId, error } = await api.rpc('place_implant_v2', {
    p_patient: patientId, p_tooth: 36, p_product: stock.productId, p_lot: stock.lotId,
    p_placed_on: new Date().toISOString().slice(0, 10), p_placing_delegate: delegate, p_supervisor: me,
  });
  expect(error).toBeNull();
  return { api, patientId, siteId: siteId as string, wrongLot: stock.lotId, rightLot, wrong, right };
}

function panel(page: Page) {
  return page.getByRole('complementary', { name: 'Tooth details' });
}

test('corrects the batch used for an implant; stock and recall follow', async ({ page }) => {
  const s = await placedImplant(page);
  await page.goto(`/patients/${s.patientId}?tooth=36`);
  await panel(page).getByRole('tab', { name: 'Corrections' }).click();
  await page.getByLabel('Correct batch').selectOption({ label: `Lot ${s.right} · 2 left` });
  await page.getByLabel('Reason for correction').fill('Wrong sticker scanned');
  await page.getByRole('button', { name: 'Correct batch' }).click();
  await expect(panel(page).getByTestId('site-details')).toContainText(`Lot ${s.right}`);
  await page.goto(`/inventory/lots/${s.wrongLot}`);
  await expect(page.getByTestId('on-hand')).toHaveText('2');
  await expect(page.getByTestId('usage-row')).toHaveCount(0);
  await page.goto(`/inventory/lots/${s.rightLot}`);
  await expect(page.getByTestId('on-hand')).toHaveText('1');
  await expect(page.getByTestId('usage-row')).toHaveCount(1);
});

test('corrects the placement date and delegate; History names the change', async ({ page }) => {
  const s = await placedImplant(page);
  const rightName = uniqueName('Dr Right');
  const right = await seedDelegate(s.api, rightName);
  await page.goto(`/patients/${s.patientId}?tooth=36`);
  await panel(page).getByRole('tab', { name: 'Corrections' }).click();
  const details = page.getByRole('group', { name: 'Placement details' });
  await details.getByLabel('Placement date').fill('2026-01-15');
  await details.getByRole('combobox', { name: 'Placed by' }).selectOption(right);
  await details.getByRole('button', { name: 'Save details' }).click();
  await expect(panel(page).getByRole('status')).toHaveText('Correction saved.');
  await expect(panel(page).getByTestId('site-details')).toContainText(rightName);

  const { data } = await s.api.from('implant_sites').select('placed_on, placing_delegate_id').eq('id', s.siteId).single();
  expect(data).toEqual({ placed_on: '2026-01-15', placing_delegate_id: right });
  await page.goto(`/patients/${s.patientId}/history`);
  await expect(page.getByRole('main')).toContainText('Implant on tooth 36 corrected: placement date, placed by');
});

async function failedVisit(api: Awaited<ReturnType<typeof placedImplant>>['api'], site: string) {
  const { error } = await api.rpc('record_visit', {
    p_site: site, p_date: new Date().toISOString().slice(0, 10), p_visit_key: null, p_check_type: '3-month', p_attendance: 'attended',
    p_outcome: 'failed', p_findings: { failure_type: 'lost', failure_reason: 'no_osseointegration' }, p_notes: '',
  });
  expect(error).toBeNull();
}

test('voids a mistaken failure and the tooth goes back to "implant placed"', async ({ page }) => {
  const s = await placedImplant(page);
  await failedVisit(s.api, s.siteId);
  await page.goto(`/patients/${s.patientId}?tooth=36`);
  await panel(page).getByText('Earlier implants on this tooth (1)').click();
  await panel(page).getByText('Corrections').click();
  await page.getByLabel('Reason for removing the follow-up').fill('Recorded on the wrong patient');
  await page.getByRole('button', { name: 'Remove follow-up' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 36, Implant placed' })).toBeVisible();
});

test('corrects the batch of a component (I7)', async ({ page }) => {
  const s = await placedImplant(page);
  const haProduct = (await s.api.from('products').insert({ type: 'healing_abutment', brand: 'E2E HA Fix', system: 'E2E', description: `HA ${Date.now()}` }).select('id').single()).data!.id as string;
  const haWrong = await receiveStock(s.api, haProduct, 1, `E2E-HAW${Date.now()}`, null);
  const haRightNo = `E2E-HAR${Date.now()}`;
  const haRight = await receiveStock(s.api, haProduct, 1, haRightNo, null);
  const me = (await s.api.auth.getUser()).data.user!.id;
  const { error } = await s.api.rpc('fit_component', {
    p_site: s.siteId, p_type: 'healing_abutment', p_fitted_on: new Date().toISOString().slice(0, 10),
    p_product: haProduct, p_lot: haWrong, p_by_organizer: me,
  });
  expect(error).toBeNull();
  await page.goto(`/patients/${s.patientId}?tooth=36`);
  await panel(page).getByRole('tab', { name: 'Corrections' }).click();
  const what = page.getByLabel('What to correct');
  const value = await what.locator('option', { hasText: 'Healing abutment' }).getAttribute('value');
  await what.selectOption(value!);
  await page.getByLabel('Correct batch').selectOption({ label: `Lot ${haRightNo} · 1 left` });
  await page.getByLabel('Reason for correction').fill('HA lot mixed up');
  await page.getByRole('button', { name: 'Correct batch' }).click();
  await expect(panel(page).getByText('Correction saved.')).toBeVisible();
  await page.goto(`/inventory/lots/${haRight}`);
  await expect(page.getByTestId('on-hand')).toHaveText('0');
  await page.goto(`/inventory/lots/${haWrong}`);
  await expect(page.getByTestId('on-hand')).toHaveText('1');
});

test('corrects the batch of a failed implant (I7)', async ({ page }) => {
  const s = await placedImplant(page);
  await failedVisit(s.api, s.siteId);
  await page.goto(`/patients/${s.patientId}?tooth=36`);
  await panel(page).getByText('Earlier implants on this tooth (1)').click();
  await panel(page).getByText('Corrections').click();
  await page.getByLabel('Correct batch').selectOption({ label: `Lot ${s.right} · 2 left` });
  await page.getByLabel('Reason for correction').fill('Recall audit');
  await page.getByRole('button', { name: 'Correct batch' }).click();
  await expect(panel(page).getByText(`Lot ${s.right}`).first()).toBeVisible();
  await page.goto(`/inventory/lots/${s.rightLot}`);
  await expect(page.getByTestId('usage-row')).toHaveCount(1);
});

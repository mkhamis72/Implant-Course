import { test, expect, type Page } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, seedDelegate, seedImplantStock } from './api';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function placedImplant(page: Page, placedDaysAgo: number) {
  const api = await apiAs(TEST_USERS.organizer.email);
  const stock = await seedImplantStock(api, { brand: uniqueName('Visit'), qty: 1, lot: `E2E-V${Date.now()}`, expiry: null });
  const delegate = await seedDelegate(api, uniqueName('Dr Visit'));
  await login(page, TEST_USERS.organizer.email);
  const name = uniqueName('Visit patient');
  const patientId = await createPatientViaUi(page, { full_name: name });
  const me = (await api.auth.getUser()).data.user!.id;
  const { error } = await api.rpc('place_implant_v2', {
    p_patient: patientId, p_tooth: 36, p_product: stock.productId, p_lot: stock.lotId, p_placed_on: daysAgo(placedDaysAgo),
    p_placing_delegate: delegate, p_supervisor: me, p_technique: 'guided',
  });
  expect(error).toBeNull();
  return { patientId, name };
}
const panel = (page: Page) => page.getByRole('complementary', { name: 'Tooth details' });

test('records the early review with probing and bleeding; the schedule and Implants tab follow', async ({ page }) => {
  const { patientId } = await placedImplant(page, 8);
  await page.goto(`/patients/${patientId}?tooth=36`);
  const schedule = panel(page).getByTestId('visit-schedule');
  await expect(schedule.getByTestId('visit-row').first()).toContainText('Due');
  await panel(page).getByRole('button', { name: 'Record visit' }).click();
  await expect(panel(page).getByRole('combobox', { name: 'Visit' })).toHaveValue('early_review');
  await panel(page).getByRole('combobox', { name: 'Outcome' }).selectOption('ok');
  await panel(page).getByLabel('Probing depth mesial').fill('3');
  await panel(page).getByLabel('Probing depth buccal').fill('4');
  await panel(page).getByLabel('Bleeding buccal').check();
  await panel(page).getByRole('button', { name: 'Save visit' }).click();
  await expect(schedule.getByTestId('visit-row').first()).toContainText('Done');
  await expect(panel(page).getByTestId('visit-records')).toContainText('PD M 3 · B 4 mm · BOP B');

  await page.goto(`/patients/${patientId}/implants`);
  await expect(page.getByTestId('next-visit')).toContainText('Osseointegration check');
});

test('a missed visit shows on the chart, the recall list and the dashboard', async ({ page }) => {
  const { patientId, name } = await placedImplant(page, 120);
  await page.goto(`/patients/${patientId}?tooth=36`);
  const rows = panel(page).getByTestId('visit-schedule').getByTestId('visit-row');
  await expect(rows.nth(0)).toContainText('Missed');
  await expect(rows.nth(1)).toContainText('Missed');

  await page.goto('/patients/recall');
  // The early review closed 99 days ago (beyond 60); the osseointegration check closed 8 days ago.
  const mine = page.getByTestId('recall-row').filter({ hasText: name });
  await expect(mine).toHaveCount(1);
  await expect(mine).toContainText('Osseointegration check');
  await expect(mine).toContainText('Missed');

  await page.goto('/');
  await expect(page.getByTestId('dash-recall')).toContainText(/missed recently/);
});

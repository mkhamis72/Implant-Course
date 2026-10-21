import { test, expect, type Page } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, enroll, seedDelegate, seedImplantStock, seedRunningCourse } from './api';

function panel(page: Page) {
  return page.getByRole('complementary', { name: 'Tooth details' });
}

/** A patient with implants placed through the API (place_implant_v3) on the given teeth, today, in a running course. */
async function setup(page: Page, teeth: number[]) {
  const api = await apiAs(TEST_USERS.organizer.email);
  const me = (await api.auth.getUser()).data.user!.id;
  const stock = await seedImplantStock(api, { brand: uniqueName('Resto'), qty: teeth.length, lot: `E2E-RS${Date.now()}`, expiry: null });
  const delegateName = uniqueName('Dr Resto');
  const delegateId = await seedDelegate(api, delegateName);
  const courseName = uniqueName('Resto course');
  const courseId = await seedRunningCourse(api, courseName);
  await enroll(api, courseId, delegateId);
  await login(page, TEST_USERS.organizer.email);
  const patientId = await createPatientViaUi(page, { full_name: uniqueName('Resto patient') });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
  for (const tooth of teeth) {
    const { error } = await api.rpc('place_implant_v3', {
      p_patient: patientId, p_tooth: tooth, p_product: stock.productId, p_lot: stock.lotId, p_placed_on: today,
      p_placing_delegate: delegateId, p_supervisor: me, p_assisting_delegate: null, p_graft: null, p_notes: null,
      p_slot: null, p_technique: 'free_hand', p_course: courseId,
    });
    expect(error).toBeNull();
  }
  await page.goto(`/patients/${patientId}`);
  return { api, patientId, delegateId, delegateName, courseId, courseName };
}

async function openRestoration(page: Page, tooth: number) {
  await page.getByRole('button', { name: new RegExp(`^Tooth ${tooth}, Implant placed`) }).click();
  await panel(page).getByRole('tab', { name: 'Restoration' }).click();
}

async function addRestoration(page: Page, stage: 'temporary' | 'final', type: string) {
  await panel(page).getByRole('button', { name: 'Add restoration' }).click();
  await panel(page).getByRole('combobox', { name: /Stage/ }).selectOption(stage);
  await panel(page).getByRole('combobox', { name: /Type/ }).selectOption(type);
}

test('records a temporary then a final crown and shows the loading', async ({ page }) => {
  await setup(page, [36]);
  await openRestoration(page, 36);
  await addRestoration(page, 'temporary', 'single_crown');
  await panel(page).getByRole('button', { name: 'Save restoration' }).click();
  await expect(panel(page).getByTestId('restoration')).toHaveCount(1);

  await addRestoration(page, 'final', 'single_crown');
  await panel(page).getByRole('button', { name: 'Save restoration' }).click();
  await expect(panel(page).getByTestId('restoration')).toHaveCount(2);

  await page.reload();
  await page.getByRole('button', { name: /^Tooth 36, Restored/ }).click();
  await panel(page).getByRole('tab', { name: 'Restoration' }).click();
  const box = panel(page).getByTestId('restorations');
  await expect(box).toContainText('Loading: Immediate');
  const cards = box.getByTestId('restoration');
  await expect(cards).toHaveCount(2);
  await expect(cards.filter({ hasText: 'Temporary' })).toContainText('Replaced on');
  const final = cards.filter({ hasText: 'Final' });
  await expect(final).toContainText('Current');
});

test('records a bridge and shows it on the odontogram', async ({ page }) => {
  await setup(page, [34, 36]);
  await openRestoration(page, 34);
  await addRestoration(page, 'final', 'bridge');
  const form = panel(page).locator('form').filter({ has: page.getByRole('button', { name: 'Save restoration' }) });
  const implants = form.getByRole('group', { name: 'Implants' });
  await expect(implants.getByRole('checkbox', { name: '34' })).toBeChecked(); // the open implant is preselected
  await implants.getByRole('checkbox', { name: '36' }).check();
  await form.getByRole('button', { name: 'Save restoration' }).click();
  await expect(panel(page).getByTestId('restoration')).toContainText('Bridge');

  await page.reload();
  const bar = page.getByRole('button', { name: 'Bridge 34–36', exact: true });
  await expect(bar).toBeVisible();
  // The first tap on a covered tooth opens the bridge's restoration (on the first implant).
  await page.getByRole('button', { name: /^Tooth 35,/ }).click();
  await expect(panel(page).getByRole('heading', { name: 'Tooth 34' })).toBeVisible();
  await expect(panel(page).getByRole('tab', { name: 'Restoration' })).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page).getByTestId('restoration')).toContainText('Bridge');
});

test('records a problem on a restoration', async ({ page }) => {
  await setup(page, [46]);
  await openRestoration(page, 46);
  await addRestoration(page, 'final', 'single_crown');
  await panel(page).getByRole('button', { name: 'Save restoration' }).click();
  await expect(panel(page).getByTestId('restoration')).toHaveCount(1);

  await panel(page).getByRole('button', { name: 'Record a problem' }).click();
  await panel(page).getByRole('combobox', { name: /^Problem/ }).selectOption('chipping');
  await panel(page).getByRole('combobox', { name: /Action taken/ }).selectOption('repaired');
  await panel(page).getByRole('button', { name: 'Save problem' }).click();
  await expect(panel(page).getByTestId('restoration')).toContainText('Chipping');
  await page.reload();
  await page.getByRole('button', { name: /^Tooth 46, Restored/ }).click();
  await panel(page).getByRole('tab', { name: 'Restoration' }).click();
  await expect(panel(page).getByTestId('restoration')).toContainText('Chipping');
});

test('course report counts the restoration for its delegate', async ({ page }) => {
  const s = await setup(page, [16]);
  await openRestoration(page, 16);
  await addRestoration(page, 'final', 'single_crown');
  const form = panel(page).locator('form').filter({ has: page.getByRole('button', { name: 'Save restoration' }) });
  await form.getByRole('combobox', { name: /^Delegate/ }).selectOption({ label: s.delegateName });
  await form.getByRole('combobox', { name: /^Course/ }).selectOption(s.courseId);
  await panel(page).getByRole('button', { name: 'Save restoration' }).click();
  await expect(panel(page).getByTestId('restoration')).toHaveCount(1);

  await page.goto(`/courses/${s.courseId}/report`);
  const row = page.getByTestId('report-delegates').getByRole('row').filter({ hasText: s.delegateName });
  await expect(row.locator('td[data-label="Restored"]')).toHaveText('1');
  const table = page.getByTestId('report-restorations');
  await expect(table.getByTestId('report-restoration')).toHaveCount(1);
  await expect(table).toContainText('Single crown');
});

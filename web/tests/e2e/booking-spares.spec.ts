import { test, expect, type Page } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { choosePatient, login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, enroll, randomFutureDate, seedChair, seedCourse, seedDelegate, seedImplantStock, seedSession } from './api';

async function world() {
  const api = await apiAs(TEST_USERS.organizer.email);
  const admin = await apiAs(TEST_USERS.admin.email);
  const day = randomFutureDate();
  const chair = uniqueName('Chair');
  await seedChair(admin, chair);
  const courseId = await seedCourse(api, { name: uniqueName('Course'), start: day, end: day });
  const session = uniqueName('Surgery day');
  await seedSession(api, { courseId, type: 'surgery', title: session, date: day });
  const placing = uniqueName('Dr Place');
  const delegateId = await seedDelegate(api, placing);
  await enroll(api, courseId, delegateId);
  const aBrand = uniqueName('SpareA');
  const a = { brand: aBrand, ...(await seedImplantStock(api, { brand: aBrand, qty: 3, lot: `E2E-SA${Date.now()}`, expiry: null })) };
  const bBrand = uniqueName('SpareB');
  const b = { brand: bBrand, ...(await seedImplantStock(api, { brand: bBrand, qty: 3, lot: `E2E-SB${Date.now()}`, expiry: null })) };
  const cBrand = uniqueName('SpareC');
  const c = { brand: cBrand, ...(await seedImplantStock(api, { brand: cBrand, qty: 3, lot: `E2E-SC${Date.now()}`, expiry: null })) };
  return { day, chair, session, placing, courseId, a, b, c };
}
type World = Awaited<ReturnType<typeof world>>;

async function bookWithSpares(page: Page, w: World, fileNo: string) {
  await page.goto(`/schedule/new?date=${w.day}`);
  const session = page.getByLabel('Surgery session');
  await session.selectOption((await session.locator('option', { hasText: w.session }).getAttribute('value'))!);
  await page.getByLabel('Chair').selectOption({ label: w.chair });
  await page.getByLabel('Start').fill('09:00');
  await page.getByLabel('End').fill('10:00');
  await choosePatient(page, fileNo);
  await page.getByLabel(`Role of ${w.placing}`).selectOption('placing');
  await page.getByLabel('Tooth 1').fill('36');
  await page.getByRole('combobox', { name: 'Implant 1' }).selectOption(w.a.productId);
  await page.getByRole('combobox', { name: 'Technique 1' }).selectOption({ label: 'Free hand' });
  await page.getByRole('button', { name: '+ Add spare' }).click();
  await page.getByRole('combobox', { name: 'Spare 1 for tooth 36' }).selectOption(w.b.productId);
  await page.getByRole('button', { name: '+ Add spare' }).click();
  await page.getByRole('combobox', { name: 'Spare 2 for tooth 36' }).selectOption(w.c.productId);
  await page.getByRole('button', { name: 'Book surgery' }).click();
  await expect(page).toHaveURL((u) => u.pathname === '/schedule' && u.searchParams.get('date') === w.day);
}

async function patientFileNo(page: Page) {
  await createPatientViaUi(page, { full_name: uniqueName('Spares patient'), file_no: `E2E-SP${Date.now()}` });
  return (await page.getByTestId('patient-header').innerText()).match(/File (\S+)/)![1];
}

test('book with a searched patient and 2 spares', async ({ page }) => {
  const w = await world();
  await login(page, TEST_USERS.organizer.email);
  const fileNo = await patientFileNo(page);
  await bookWithSpares(page, w, fileNo);
  const card = page.getByTestId(`booking-${fileNo}`);
  await expect(card).toContainText('Spares:');
  await expect(card).toContainText(w.b.brand);
  await expect(card).toContainText(w.c.brand);
});

test('edit: change implant and spares, add then remove a tooth', async ({ page }) => {
  const w = await world();
  await login(page, TEST_USERS.organizer.email);
  const fileNo = await patientFileNo(page);
  await bookWithSpares(page, w, fileNo);
  const card = () => page.getByTestId(`booking-${fileNo}`);

  // Change the implant to B, drop the first spare, and add tooth 46 with a spare.
  await card().getByRole('link', { name: 'Edit booking' }).click();
  await page.getByRole('combobox', { name: 'Implant 1' }).selectOption(w.b.productId);
  await page.getByRole('button', { name: 'Remove spare 1 for tooth 36' }).click();
  await page.getByRole('button', { name: '+ Add another implant' }).click();
  await page.getByRole('textbox', { name: 'Tooth 2' }).fill('46');
  await page.getByRole('combobox', { name: 'Implant 2' }).selectOption(w.a.productId);
  await page.getByRole('combobox', { name: 'Technique 2' }).selectOption({ label: 'Guided' });
  await page.getByRole('button', { name: '+ Add spare' }).nth(1).click();
  await page.getByRole('combobox', { name: 'Spare 1 for tooth 46' }).selectOption(w.b.productId);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page).toHaveURL((u) => u.pathname === '/schedule' && u.searchParams.get('date') === w.day);
  await expect(card()).toContainText('Tooth 46');
  await expect(card()).toContainText(`Tooth 36 · Spares: ${w.c.brand}`);
  await expect(card()).toContainText(`Tooth 46 · Spares: ${w.b.brand}`);
  await expect(card()).not.toContainText(`Tooth 36 · Spares: ${w.b.brand}`);

  // Remove tooth 46 again.
  await card().getByRole('link', { name: 'Edit booking' }).click();
  await page.getByRole('button', { name: 'Remove tooth 2' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page).toHaveURL((u) => u.pathname === '/schedule' && u.searchParams.get('date') === w.day);
  await expect(card()).toContainText('Tooth 36');
  await expect(card()).not.toContainText('Tooth 46');
});

test('placed tooth is locked', async ({ page }) => {
  const w = await world();
  await login(page, TEST_USERS.organizer.email);
  const fileNo = await patientFileNo(page);
  const patientUrl = page.url();
  await bookWithSpares(page, w, fileNo);

  await page.goto(`${patientUrl}${patientUrl.includes('?') ? '&' : '?'}tooth=36`);
  const panel = page.getByRole('complementary', { name: 'Tooth details' });
  await panel.getByRole('button', { name: 'Place implant' }).click();
  await page.getByRole('radiogroup', { name: 'Stock batch' }).getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Save placement' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 36, Implant placed' })).toBeVisible();

  // Placing closes the booking: reopen it to edit.
  await page.goto(`/schedule?date=${w.day}`);
  await page.getByTestId(`booking-${fileNo}`).getByRole('button', { name: 'Reopen' }).click();
  await page.getByTestId(`booking-${fileNo}`).getByRole('link', { name: 'Edit booking' }).click();
  await expect(page.getByText('Placed — change it in Corrections')).toBeVisible();
});

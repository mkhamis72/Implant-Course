import { test, expect, type Page } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login, chooseImplant } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, enroll, seedDelegate, seedImplantStock, seedRunningCourse } from './api';
import { ACADEMY, withPg } from './companies';

// Inventory switched off by the company's plan (academy runs on an E2E plan with Statistics only).
// Implants are placed without a batch; a batch is attached later once Inventory is back.

const FULL_PLAN = 'fa110000-0000-4000-8000-000000000001';
const PLAN_NAME = `E2E NoInventory ${Date.now()}`;

test.describe.configure({ mode: 'serial' });

let brand = '';
let lotNo = '';
let lotId = '';
let delegate = '';
let courseId = '';
let patientId = '';

async function setPlan(planId: string) {
  await withPg((pg) => pg.query('update public.companies set plan_id = $2 where id = $1', [ACADEMY, planId]));
}

const onHand = (lot: string) =>
  withPg(async (pg) =>
    Number((await pg.query('select coalesce(sum(delta), 0)::int as n from public.stock_movements where stock_lot_id = $1', [lot])).rows[0].n));

function panel(page: Page) {
  return page.getByRole('complementary', { name: 'Tooth details' });
}

test.beforeAll(async () => {
  // Seed while Inventory is still on (Full plan), then switch it off.
  const api = await apiAs(TEST_USERS.organizer.email);
  brand = uniqueName('NoInv');
  lotNo = `E2E-NI${Date.now()}`;
  const stock = await seedImplantStock(api, { brand, qty: 3, lot: lotNo, expiry: '2031-12-31' });
  lotId = stock.lotId;
  delegate = uniqueName('Dr NoInv');
  const delegateId = await seedDelegate(api, delegate);
  courseId = await seedRunningCourse(api, uniqueName('Course'));
  await enroll(api, courseId, delegateId);
  await withPg(async (pg) => {
    await pg.query('delete from public.plans where name = $1 and id <> $2', [PLAN_NAME, FULL_PLAN]);
    const { rows } = await pg.query(
      `insert into public.plans (name, kind, modules) values ($1, 'course_organizer', '{statistics}') returning id`,
      [PLAN_NAME],
    );
    await pg.query('update public.companies set plan_id = $2 where id = $1', [ACADEMY, rows[0].id]);
  });
});

test.afterAll(async () => {
  try {
    await setPlan(FULL_PLAN);
  } finally {
    await withPg((pg) => pg.query('delete from public.plans where name = $1 and id <> $2', [PLAN_NAME, FULL_PLAN]));
  }
});

test('Inventory disappears', async ({ page }) => {
  await login(page, TEST_USERS.admin.email);
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Inventory' })).toHaveCount(0);
  await expect(page.getByText('Low stock')).toHaveCount(0);
  await expect(page.getByText('Stock shortages')).toHaveCount(0);
  await page.goto('/inventory');
  await expect(page).not.toHaveURL(/\/inventory/);
  await page.goto('/schedule/pull-list');
  await expect(page).not.toHaveURL(/pull-list/);
});

test('place an implant from the catalogue', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  patientId = await createPatientViaUi(page, { full_name: uniqueName('NoInv patient') });
  await page.getByRole('button', { name: 'Tooth 36, Present' }).click();
  await panel(page).getByRole('button', { name: 'Place implant' }).click();
  await chooseImplant(page, brand, 'Ø4.0 × 10 mm');
  await expect(page.getByRole('radiogroup', { name: 'Stock batch' })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Course' }).selectOption(courseId);
  await page.getByLabel('Placed by (delegate)').selectOption({ label: delegate });
  await page.getByRole('combobox', { name: 'Technique' }).selectOption({ label: 'Free hand' });
  await page.getByRole('button', { name: 'Save placement' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 36, Implant placed' })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Tooth 36, Implant placed' }).click();
  await panel(page).getByRole('tab', { name: 'Implant' }).click();
  await expect(panel(page).getByTestId('site-details')).not.toContainText('Lot ');

  const site = await withPg(async (pg) =>
    (await pg.query('select id, stock_lot_id from public.implant_sites where patient_id = $1', [patientId])).rows);
  expect(site).toHaveLength(1);
  expect(site[0].stock_lot_id).toBeNull();
  const moves = await withPg(async (pg) =>
    Number((await pg.query('select count(*)::int as n from public.stock_movements where implant_site_id = $1', [site[0].id])).rows[0].n));
  expect(moves).toBe(0);
});

test('attach a batch later', async ({ page }) => {
  const before = await onHand(lotId);
  await login(page, TEST_USERS.organizer.email);
  await setPlan(FULL_PLAN);
  await page.goto(`/patients/${patientId}?tooth=36`);
  await expect(panel(page).getByTestId('site-details')).toContainText('No stock batch recorded');
  await panel(page).getByRole('tab', { name: 'Corrections' }).click();
  const lots = page.getByLabel('Stock batch');
  await lots.selectOption(lotId);
  await page.getByLabel('Reason for correction').fill('Batch found later');
  await page.getByRole('button', { name: 'Attach stock batch' }).click();
  await expect(panel(page).getByRole('status')).toHaveText('Correction saved.');
  await expect(panel(page).getByTestId('site-details')).toContainText(`Lot ${lotNo}`);
  expect(await onHand(lotId)).toBe(before);
});

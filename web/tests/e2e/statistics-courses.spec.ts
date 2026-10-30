import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, seedCourse, seedDelegate, seedImplantStock, placeImplant } from './api';

const today = () => new Date().toISOString().slice(0, 10);

test('Courses compares two ticked courses and opens them in Explore', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const api = await apiAs(TEST_USERS.organizer.email);
  const brand = uniqueName('Crs');
  const stock = await seedImplantStock(api, { brand, qty: 3, lot: `E2E-CR${Date.now()}`, expiry: null });
  const delegate = await seedDelegate(api, uniqueName('Dr Crs'));
  const me = (await api.auth.getUser()).data.user!.id;
  const nameA = uniqueName('Course A');
  const nameB = uniqueName('Course B');
  const courseA = await seedCourse(api, { name: nameA, start: today(), end: today() });
  // Started earlier, so it lists after A (courses are newest first).
  const courseB = await seedCourse(api, { name: nameB, start: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), end: today() });

  await login(page, TEST_USERS.organizer.email);
  const patientA = await createPatientViaUi(page, { full_name: uniqueName('Courses patient') });
  const patientB = await createPatientViaUi(page, { full_name: uniqueName('Courses patient') });
  for (const [patient, tooth, course] of [[patientA, 16, courseA], [patientA, 26, courseA], [patientB, 36, courseB]] as const) {
    const placed = await placeImplant(api, {
      p_patient: patient, p_tooth: tooth, p_product: stock.productId, p_lot: stock.lotId, p_placed_on: today(),
      p_placing_delegate: delegate, p_supervisor: me, p_course: course,
    });
    expect(placed.error).toBeNull();
  }

  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  try {
    await login(admin, TEST_USERS.admin.email);
    await admin.goto('/statistics/courses');
    await expect(admin.getByRole('heading', { level: 1, name: 'Courses' })).toBeVisible();
    await expect(admin.getByText(new RegExp(`${nameA} · .* · 2 implants · 1 patient`))).toBeVisible();

    await admin.getByRole('checkbox', { name: `Compare ${nameA}` }).check();
    await admin.getByRole('button', { name: 'Compare' }).click();
    await expect(admin.getByText('Tick at least two courses to compare them.')).toBeVisible();

    await admin.getByRole('checkbox', { name: `Compare ${nameB}` }).check();
    await admin.getByRole('button', { name: 'Compare' }).click();
    await expect(admin).toHaveURL(/c=.*c=/);

    const table = admin.getByRole('table', { name: 'Side-by-side comparison' });
    await expect(table.getByRole('columnheader', { name: nameA })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: nameB })).toBeVisible();
    const row = (name: string) => table.getByRole('row').filter({ has: admin.getByRole('cell', { name, exact: true }) });
    await expect(row('Implants').getByRole('cell')).toHaveText(['Implants', '2', '1']);
    await expect(row('Patients').getByRole('cell')).toHaveText(['Patients', '1', '1']);
    await expect(row('Final restoration').getByRole('cell')).toHaveText(['Final restoration', '0 of 2', '0 of 1']);

    // On a phone the comparison stacks; the page itself never scrolls sideways.
    await admin.setViewportSize({ width: 360, height: 740 });
    // Stacked cells lose their table role, so this finds the cell by its data-label.
    await expect(admin.locator('td[data-label="Measure"]', { hasText: 'Implants' }).first()).toBeVisible();
    expect(await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await admin.setViewportSize({ width: 1280, height: 720 });

    await admin.getByRole('link', { name: 'Explore these courses' }).click();
    await expect(admin).toHaveURL(/f=course/);
    await expect(admin).toHaveURL(/x_course=/);
    await expect(admin.getByRole('heading', { level: 1, name: 'Explore clinical data' })).toBeVisible();
    await expect(admin.getByRole('combobox', { name: 'Compare by' })).toHaveValue('course');
    await expect(admin.getByText(`Course: ${nameA}, ${nameB}`).first()).toBeVisible();
  } finally {
    await adminCtx.close();
  }
});

test('A delegate cannot open Courses', async ({ page }) => {
  await login(page, TEST_USERS.delegate.email);
  await page.goto('/statistics/courses');
  await expect(page).toHaveURL(/\/my/);
  await expect(page.getByRole('heading', { level: 1, name: 'Courses' })).toHaveCount(0);
});

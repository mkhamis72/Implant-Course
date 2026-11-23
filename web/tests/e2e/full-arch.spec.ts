import { test, expect, type Page } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, enroll, seedDelegate, seedImplantStock, seedRunningCourse } from './api';

const TEETH = [15, 12, 22, 25];
const ARCH = [15, 14, 13, 12, 11, 21, 22, 23, 24, 25];

/**
 * A full-arch case through the API: implants placed at 15, 12, 22, 25 (place_implant_v4), 15 and 25 tilted 30° distal
 * (set_implant_geometry), and a final full-arch restoration over 15–25 on those four implants (add_restoration).
 */
async function setup(page: Page) {
  const api = await apiAs(TEST_USERS.organizer.email);
  const me = (await api.auth.getUser()).data.user!.id;
  const stock = await seedImplantStock(api, { brand: uniqueName('Arch'), qty: TEETH.length, lot: `E2E-FA${Date.now()}`, expiry: null });
  const delegateId = await seedDelegate(api, uniqueName('Dr Arch'));
  const courseId = await seedRunningCourse(api, uniqueName('Arch course'));
  await enroll(api, courseId, delegateId);
  await login(page, TEST_USERS.organizer.email);
  const patientId = await createPatientViaUi(page, { full_name: uniqueName('Arch patient') });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
  const sites: Record<number, string> = {};
  for (const tooth of TEETH) {
    const { data, error } = await api.rpc('place_implant_v4', {
      p_patient: patientId, p_tooth: tooth, p_product: stock.productId, p_lot: stock.lotId, p_placed_on: today,
      p_placing_delegate: delegateId, p_supervisor: me, p_assisting_delegate: null, p_graft: null, p_notes: null,
      p_slot: null, p_technique: 'free_hand', p_course: courseId, p_placing_doctor: null,
    });
    expect(error).toBeNull();
    sites[tooth] = data as string;
  }
  for (const tooth of [15, 25]) {
    const { error } = await api.rpc('set_implant_geometry', {
      p_site: sites[tooth], p_type: 'tilted', p_angulation: 30, p_direction: 'distal', p_anchorage: null, p_entry: null, p_trajectory: null,
    });
    expect(error).toBeNull();
  }
  const { error } = await api.rpc('add_restoration', {
    p_patient: patientId, p_stage: 'final', p_type: 'full_arch', p_sites: TEETH.map((t) => sites[t]), p_teeth: ARCH, p_fitted_on: today,
    p_retention: 'screw', p_material: null, p_delegate: delegateId, p_supervisor: null, p_course: courseId, p_remake_reason: null, p_notes: null,
  });
  expect(error).toBeNull();
  return { patientId };
}

test('full-arch case shows four implants under one bridge', async ({ page }) => {
  const { patientId } = await setup(page);
  await page.goto(`/patients/${patientId}`);
  await page.getByRole('button', { name: 'Full arch', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Full arch', exact: true, pressed: true })).toBeVisible();
  await expect(page).toHaveURL(/[?&]view=arch/);
  await expect(page.getByRole('img', { name: 'Full-arch chart' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Implant \d+,/ })).toHaveCount(4);
  await expect(page.getByRole('button', { name: /Implant 15, Tilted, 30° distal/ })).toBeVisible();
  const bridge = page.getByRole('button', { name: /final/ });
  await expect(bridge).toHaveCount(1);
  await bridge.click();
  const panel = page.getByRole('complementary', { name: 'Tooth details' });
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText(/15/);
  await expect(panel.getByRole('tab', { name: /^Restoration/ })).toHaveAttribute('aria-selected', 'true');
});

test('teeth view unchanged', async ({ page }) => {
  const { patientId } = await setup(page);
  await page.goto(`/patients/${patientId}?view=arch`);
  await expect(page.getByRole('button', { name: 'Full arch', exact: true, pressed: true })).toBeVisible();
  // Without `view` the chart opens on Teeth, as before.
  await page.goto(`/patients/${patientId}`);
  await expect(page.getByRole('button', { name: 'Teeth', exact: true, pressed: true })).toBeVisible();
  await expect(page.locator('[data-tooth="15"] [data-type-label]')).toHaveText('TLT');
});

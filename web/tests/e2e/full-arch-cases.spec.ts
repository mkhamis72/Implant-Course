import { test, expect, type Locator, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, enroll, seedDelegate, seedImplantStock, seedRunningCourse } from './api';

const TEETH = [15, 12, 22, 25];
const ARCH = [15, 14, 13, 12, 11, 21, 22, 23, 24, 25];

const cairoToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());

/** A patient with implants planned at 15, 12, 22, 25 (plan_implant), and what placing them needs. */
async function setup(page: Page) {
  const api = await apiAs(TEST_USERS.organizer.email);
  const me = (await api.auth.getUser()).data.user!.id;
  const stock = await seedImplantStock(api, { brand: uniqueName('Case'), qty: TEETH.length, lot: `E2E-FC${Date.now()}`, expiry: null });
  const delegateId = await seedDelegate(api, uniqueName('Dr Case'));
  const courseId = await seedRunningCourse(api, uniqueName('Case course'));
  await enroll(api, courseId, delegateId);
  await login(page, TEST_USERS.organizer.email);
  const patientId = await createPatientViaUi(page, { full_name: uniqueName('Case patient') });
  for (const tooth of TEETH) {
    const { error } = await api.rpc('plan_implant', {
      p_patient: patientId, p_tooth: tooth, p_product: stock.productId, p_notes: '', p_technique: null,
    });
    expect(error).toBeNull();
  }
  return { api, me, stock, delegateId, courseId, patientId };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Places the four planned implants (place_implant_v4 turns each planned site into the placed one). */
async function placeAll(s: Setup): Promise<Record<number, string>> {
  const sites: Record<number, string> = {};
  for (const tooth of TEETH) {
    const { data, error } = await s.api.rpc('place_implant_v4', {
      p_patient: s.patientId, p_tooth: tooth, p_product: s.stock.productId, p_lot: s.stock.lotId, p_placed_on: cairoToday(),
      p_placing_delegate: s.delegateId, p_supervisor: s.me, p_assisting_delegate: null, p_graft: null, p_notes: null,
      p_slot: null, p_technique: 'free_hand', p_course: s.courseId, p_placing_doctor: null,
    });
    expect(error).toBeNull();
    sites[tooth] = data as string;
  }
  return sites;
}

async function addBridge(api: SupabaseClient, s: Setup, sites: Record<number, string>, stage: 'temporary' | 'final'): Promise<string> {
  const { data, error } = await api.rpc('add_restoration', {
    p_patient: s.patientId, p_stage: stage, p_type: 'full_arch', p_sites: TEETH.map((t) => sites[t]), p_teeth: ARCH,
    p_fitted_on: cairoToday(), p_retention: 'screw', p_material: null, p_delegate: s.delegateId, p_supervisor: null,
    p_course: s.courseId, p_remake_reason: null, p_notes: null,
  });
  expect(error).toBeNull();
  return data as string;
}

async function recordStage(page: Page, stage: string, label: string, fill?: (form: Locator) => Promise<void>) {
  await page.getByTestId(`stage-${stage}`).getByRole('button', { name: 'Record' }).click();
  const form = page.getByRole('form', { name: label });
  if (fill) await fill(form);
  await form.getByRole('button', { name: 'Save stage' }).click();
  await expect(form).toBeHidden();
  await expect(page.getByTestId(`stage-${stage}`)).toContainText('✓');
}

test('full-arch case from plan to final bridge', async ({ page }) => {
  const s = await setup(page);
  await page.goto(`/patients/${s.patientId}?view=arch`);
  await expect(page.getByRole('button', { name: 'Full arch', exact: true, pressed: true })).toBeVisible();

  // Start the upper case: the four planned implants start ticked.
  await page.getByRole('button', { name: 'Start upper case' }).click();
  const start = page.getByRole('form', { name: 'New upper case' });
  await start.getByRole('combobox', { name: 'Configuration' }).selectOption({ label: 'All-on-4' });
  await expect(start.getByRole('checkbox', { checked: true })).toHaveCount(4);
  await start.getByRole('button', { name: 'Start case' }).click();

  const card = page.getByRole('region', { name: 'Upper arch · All-on-4' });
  const caption = page.getByTestId('case-caption-upper');
  await expect(card.getByText('Planned', { exact: true })).toBeVisible();
  await expect(caption).toContainText('Upper arch · All-on-4 · Planned');
  await expect(page.getByRole('button', { name: 'Start upper case' })).toHaveCount(0);

  // Placing the implants moves the case into treatment.
  const sites = await placeAll(s);
  await page.reload();
  await expect(caption).toContainText('Upper arch · All-on-4 · In treatment');
  await expect(card.getByText('In treatment', { exact: true })).toBeVisible();

  // A temporary bridge over 15–25 joins the case by itself.
  await addBridge(s.api, s, sites, 'temporary');
  await page.reload();
  await expect(card.getByTestId('bridge-temporary')).toHaveText(/^Delivered /);
  await expect(card.getByTestId('bridge-final')).toHaveText('Not yet');

  // The lab stages, through the panel.
  await recordStage(page, 'scan', 'Scan / impression');
  await recordStage(page, 'lab_design', 'Lab and design approved', async (form) => {
    await form.getByRole('textbox', { name: 'Lab name' }).fill('E2E Lab');
  });
  await expect(page.getByTestId('stage-lab_design')).toContainText('E2E Lab');
  await recordStage(page, 'try_in', 'Try-in', async (form) => {
    await form.getByRole('combobox', { name: 'Passive fit' }).selectOption({ label: 'Yes' });
  });
  await expect(page.getByTestId('stage-try_in')).toContainText('Passive fit: yes');
  await expect(caption).toContainText('Scan ✓ · Lab ✓ · Try-in ✓ · Delivery —');

  // The final bridge completes the case; its fitted date is the delivery.
  const final = await addBridge(s.api, s, sites, 'final');
  await page.reload();
  await expect(caption).toContainText('Upper arch · All-on-4 · Completed');
  await expect(caption).toContainText('Delivery ✓');
  await expect(card.getByTestId('bridge-final')).toHaveText(/^Delivered /);
  const delivered = (await card.getByTestId('bridge-final').textContent())!.replace('Delivered ', '');
  await expect(card.getByTestId('stage-delivery')).toContainText(`✓ ${delivered}`);

  // Voiding the final takes the case back into treatment.
  const { error } = await s.api.rpc('void_restoration', { p_restoration: final, p_reason: 'E2E entered by mistake' });
  expect(error).toBeNull();
  await page.reload();
  await expect(caption).toContainText('Upper arch · All-on-4 · In treatment');
  await expect(caption).toContainText('Delivery —');
  await expect(card.getByTestId('bridge-final')).toHaveText('Not yet');
});

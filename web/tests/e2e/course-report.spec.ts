import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { uniqueName } from './patients';
import { apiAs, enroll, seedChair, seedCourse, seedDelegate, seedImplantStock, seedSession, placeImplant } from './api';

test('course report shows each placed implant, a session summary, and downloads a CSV', async ({ page }) => {
  const admin = await apiAs(TEST_USERS.admin.email);
  const api = await apiAs(TEST_USERS.organizer.email);
  const supervisor = (await api.auth.getUser()).data.user!.id;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
  const courseName = uniqueName('Report course');
  const courseId = await seedCourse(api, { name: courseName, start: today, end: today });
  const session = await seedSession(api, { courseId, type: 'surgery', title: 'Report surgery', date: today });
  const chair = await seedChair(admin, uniqueName('Chair'));
  const placer = uniqueName('Dr Placer');
  const assistant = uniqueName('Dr Assist');
  const d1 = await seedDelegate(api, placer);
  const d2 = await seedDelegate(api, assistant);
  await enroll(api, courseId, d1);
  await enroll(api, courseId, d2);
  const { productId, lotId } = await seedImplantStock(api, { brand: uniqueName('Brand'), qty: 2, lot: `E2E-R${Date.now()}`, expiry: null });
  const patient = uniqueName('Report patient');
  const { data: p } = await api.from('patients').insert({ full_name: patient }).select('id').single();
  const { data: slot, error: bookError } = await api.rpc('create_surgery_slot', {
    p_session: session, p_chair: chair, p_start: '23:00', p_end: '23:30', p_patient: p!.id, p_supervisor: supervisor,
    p_placing: [d1], p_assisting: [d2], p_implants: [{ tooth: 36, technique: 'guided' }], p_override_reason: 'E2E report',
  });
  expect(bookError).toBeNull();
  const { data: placed, error: placeError } = await placeImplant(api, {
    p_patient: p!.id, p_tooth: 36, p_product: productId, p_lot: lotId, p_placed_on: today, p_placing_delegate: d1,
    p_supervisor: supervisor, p_assisting_delegate: d2, p_slot: slot, p_technique: 'guided', p_course: courseId,
  });
  expect(placeError).toBeNull();
  const { error: stabilityError } = await api.rpc('save_implant_surgery_v2', {
    p_site: placed, p_extraction_date: null, p_placement_timing: null, p_soft_tissue_phenotype: null, p_keratinized_mucosa_mm: null,
    p_flap: null, p_torque_type: null, p_healing: null, p_primary_closure: null, p_grafting_performed: null,
    p_torque: 35, p_isq: 72, p_bone_type: 'D2', p_expected_updated_at: null,
  });
  expect(stabilityError).toBeNull();

  await login(page, TEST_USERS.viewer.email);
  await page.goto(`/courses/${courseId}`);
  await page.getByRole('link', { name: 'Report' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(courseName);
  await expect(page.getByText(/only shown to users with access to Patients/)).toHaveCount(0);
  const section = page.getByTestId('report-session').filter({ hasText: 'Report surgery' });
  await expect(section).toContainText('1 implant');
  const implant = section.getByTestId('report-implant').filter({ hasText: patient });
  await expect(implant).toContainText(placer);
  await expect(implant).toContainText(assistant);
  await expect(implant).toContainText('35');
  await expect(implant).toContainText('72');
  await expect(implant).toContainText('D2');
  await expect(page.getByTestId('report-delegates')).toContainText(placer);

  // Printed, the session table must not be clipped by its scroll box.
  await page.emulateMedia({ media: 'print' });
  const overflow = await section.locator('table').evaluate((t) => getComputedStyle(t.parentElement!).overflowX);
  expect(overflow).toBe('visible');
  await page.emulateMedia({ media: 'screen' });

  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.csv$/);
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8');
  expect(text).toContain('Session,Session date,Patient,File');
  expect(text).toContain(patient);
});

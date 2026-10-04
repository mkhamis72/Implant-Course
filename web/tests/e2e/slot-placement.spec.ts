import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, enroll, randomFutureDate, seedChair, seedCourse, seedDelegate, seedImplantStock, seedSession } from './api';

test('placing a booked implant is pre-filled and closes the booking', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const admin = await apiAs(TEST_USERS.admin.email);
  const day = randomFutureDate();
  const chair = uniqueName('Chair');
  const chairId = await seedChair(admin, chair);
  const courseId = await seedCourse(api, { name: uniqueName('Course'), start: day, end: day });
  const sessionId = await seedSession(api, { courseId, type: 'surgery', title: 'Booked day', date: day });
  const placingName = uniqueName('Dr Booked');
  const placing = await seedDelegate(api, placingName);
  await enroll(api, courseId, placing);
  const brand = uniqueName('Booked');
  const stock = await seedImplantStock(api, { brand, qty: 2, lot: `E2E-K${Date.now()}`, expiry: null });

  await login(page, TEST_USERS.organizer.email);
  const patientId = await createPatientViaUi(page, { full_name: uniqueName('Booked patient') });
  const me = (await api.auth.getUser()).data.user!.id;
  const { data: slotId, error } = await api.rpc('create_surgery_slot', {
    p_session: sessionId, p_chair: chairId, p_start: '10:00', p_end: '11:00', p_patient: patientId, p_supervisor: me,
    p_placing: [placing], p_implants: [{ tooth: 36, product_id: stock.productId, technique: 'guided' }],
  });
  expect(error).toBeNull();

  await page.goto(`/patients/${patientId}?tooth=36`);
  const panel = page.getByRole('complementary', { name: 'Tooth details' });
  await expect(panel).toContainText(`Booked: `);
  await expect(panel).toContainText(chair);
  await panel.getByRole('button', { name: 'Place implant' }).click();
  await expect(page.getByLabel('Placed by (delegate)')).toHaveValue(placing);
  await expect(page.getByRole('combobox', { name: 'Implant', exact: true })).toHaveValue(stock.productId);
  await expect(page.getByRole('combobox', { name: 'Technique' })).toHaveValue('guided');
  await page.getByRole('radiogroup', { name: 'Stock batch' }).getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Save placement' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 36, Implant placed' })).toBeVisible();

  const { data: slot } = await api.from('surgery_slots').select('status').eq('id', slotId as string).single();
  expect(slot!.status).toBe('done');
  const { data: site } = await api.from('implant_sites').select('course_id').eq('patient_id', patientId).single();
  expect(site!.course_id).toBe(courseId);
});

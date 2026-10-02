import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, enroll, receiveStock, seedChair, seedCourse, seedDelegate, seedProduct, seedSession } from './api';

test('dashboard shows today, shortages, stock alerts and my items', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const admin = await apiAs(TEST_USERS.admin.email);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
  const me = (await api.auth.getUser()).data.user!.id;

  const lowBrand = uniqueName('Low');
  const low = await seedProduct(api, { type: 'implant', brand: lowBrand, diameter_mm: 4, length_mm: 10 });
  await api.from('products').update({ reorder_level: 5 }).eq('id', low);
  const soon = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  await receiveStock(api, low, 1, `E2E-D${Date.now()}`, soon);

  const courseId = await seedCourse(api, { name: uniqueName('Today course'), start: today, end: today });
  const sessionId = await seedSession(api, { courseId, type: 'surgery', title: 'Today', date: today });
  const chairName = uniqueName('Chair');
  const chairId = await seedChair(admin, chairName);
  const delegate = await seedDelegate(api, uniqueName('Dr Today'));
  await enroll(api, courseId, delegate);

  await login(page, TEST_USERS.organizer.email);
  const patientName = uniqueName('Today patient');
  const patientId = await createPatientViaUi(page, { full_name: patientName });
  const { error } = await api.rpc('create_surgery_slot', {
    p_session: sessionId, p_chair: chairId, p_start: '23:00', p_end: '23:30', p_patient: patientId, p_supervisor: me,
    p_placing: [delegate], p_implants: [{ tooth: 36, product_id: low }, { tooth: 46, product_id: low }],
    p_override_reason: 'E2E dashboard',
  });
  expect(error).toBeNull();

  const task = uniqueName('Call the lab');
  const { data: list } = await api.rpc('create_checklist', { p_title: uniqueName('Dash list'), p_items: [task] });
  const { data: item } = await api.from('checklist_items').select('id').eq('checklist_id', list as string).single();
  await api.from('checklist_items').update({ assignee_id: me }).eq('id', item!.id);

  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByTestId('dash-chair').filter({ hasText: chairName }).getByTestId('dash-surgery')).toContainText(patientName);
  await expect(page.getByTestId('dash-shortage').filter({ hasText: lowBrand })).toContainText('need 2, have 1');
  await expect(page.getByTestId('dash-low').filter({ hasText: lowBrand })).toBeVisible();
  await expect(page.getByTestId('dash-expiring').filter({ hasText: lowBrand })).toBeVisible();
  await expect(page.getByTestId('dash-my-item').filter({ hasText: task })).toBeVisible();
});

test('empty states are friendly for an inactive-free view', async ({ page }) => {
  await login(page, TEST_USERS.mfa.email);
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'My open checklist items' })).toBeVisible();
  await expect(page.getByText('Nothing assigned to you is open.')).toBeVisible();
});

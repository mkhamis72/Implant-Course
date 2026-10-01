import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, enroll, randomFutureDate, seedChair, seedCourse, seedDelegate, seedImplantStock, seedSession } from './api';

test('shows what the day needs against usable stock and flags shortages', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const admin = await apiAs(TEST_USERS.admin.email);
  const day = randomFutureDate();
  const chairId = await seedChair(admin, uniqueName('Chair'));
  const courseId = await seedCourse(api, { name: uniqueName('Course'), start: day, end: day });
  const sessionId = await seedSession(api, { courseId, type: 'surgery', title: 'Pull day', date: day });
  const delegateId = await seedDelegate(api, uniqueName('Dr Pull'));
  await enroll(api, courseId, delegateId);
  const brand = uniqueName('Pull');
  const stock = await seedImplantStock(api, { brand, qty: 1, lot: `E2E-P${Date.now()}`, expiry: null });

  await login(page, TEST_USERS.organizer.email);
  const patientId = await createPatientViaUi(page, { full_name: uniqueName('Pull patient') });
  const me = (await api.auth.getUser()).data.user!.id;
  const { error } = await api.rpc('create_surgery_slot', {
    p_session: sessionId, p_chair: chairId, p_start: '09:00', p_end: '11:00', p_patient: patientId, p_supervisor: me,
    p_placing: [delegateId], p_implants: [{ tooth: 36, product_id: stock.productId }, { tooth: 46, product_id: stock.productId }],
  });
  expect(error).toBeNull();

  await page.goto(`/schedule/pull-list?date=${day}`);
  const row = page.getByTestId('pull-row').filter({ hasText: brand });
  await expect(row).toContainText('2');
  await expect(row).toContainText('1');
  await expect(row).toContainText('Short by 1');
  await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();
});

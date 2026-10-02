import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, enroll, randomFutureDate, seedChair, seedCourse, seedDelegate, seedSession } from './api';

test('default templates attach to new sessions and bookings', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const admin = await apiAs(TEST_USERS.admin.email);
  const dayItem = uniqueName('Room ready');
  const patientItem = uniqueName('Consent signed');
  for (const [scope, item] of [['surgery', dayItem], ['surgery_booking', patientItem]] as const) {
    const { error } = await api.rpc('save_template', {
      p_template: null, p_name: uniqueName(`Default ${scope}`), p_applies_to: scope, p_is_default: true, p_items: [item],
    });
    expect(error).toBeNull();
  }
  const day = randomFutureDate();
  const courseId = await seedCourse(api, { name: uniqueName('Course'), start: day, end: day });
  const sessionId = await seedSession(api, { courseId, type: 'surgery', title: uniqueName('Surgery day'), date: day });
  const chairId = await seedChair(admin, uniqueName('Chair'));
  const delegate = await seedDelegate(api, uniqueName('Dr Attach'));
  await enroll(api, courseId, delegate);

  await login(page, TEST_USERS.organizer.email);
  const patientId = await createPatientViaUi(page, { full_name: uniqueName('Attach patient') });
  const me = (await api.auth.getUser()).data.user!.id;
  const { error } = await api.rpc('create_surgery_slot', {
    p_session: sessionId, p_chair: chairId, p_start: '08:00', p_end: '09:00', p_patient: patientId, p_supervisor: me,
    p_placing: [delegate], p_override_reason: 'E2E',
  });
  expect(error).toBeNull();

  await page.goto(`/courses/${courseId}`);
  await page.getByTestId('session-row').getByRole('link', { name: /Checklist 0\/1 done/ }).click();
  await expect(page.getByRole('checkbox', { name: dayItem })).toBeVisible();

  await page.goto(`/schedule?date=${day}`);
  const card = page.locator('[data-testid^="booking-"]').filter({ has: page.getByRole('link', { name: /Attach patient/ }) });
  await card.getByRole('link', { name: /Checklist 0\/1 done/ }).click();
  await page.getByRole('checkbox', { name: patientItem }).check();
  await expect(page.getByTestId('checklist-progress')).toHaveText('1/1 done');
});

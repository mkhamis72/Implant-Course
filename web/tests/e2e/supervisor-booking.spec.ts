import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { uniqueName } from './patients';
import { apiAs, enroll, randomFutureDate, seedChair, seedCourse, seedDelegate, seedSession } from './api';

test('an organizer books a surgery with a name-only supervisor', async ({ page }) => {
  const adminApi = await apiAs(TEST_USERS.admin.email);
  const api = await apiAs(TEST_USERS.organizer.email);
  const prof = uniqueName('Prof');
  const { error } = await adminApi.from('supervisors').insert({ full_name: prof });
  expect(error).toBeNull();
  const date = randomFutureDate();
  const course = await seedCourse(api, { name: uniqueName('Course'), start: date, end: date });
  const session = await seedSession(api, { courseId: course, type: 'surgery', title: 'Surgery day', date });
  const chair = uniqueName('Chair');
  await seedChair(adminApi, chair);
  const delegate = uniqueName('Dr D');
  await enroll(api, course, await seedDelegate(api, delegate));
  const patient = await api.from('patients').insert({ full_name: uniqueName('Sup patient') }).select('file_no').single();
  expect(patient.error).toBeNull();

  await login(page, TEST_USERS.organizer.email);
  await page.goto(`/schedule/new?session=${session}`);
  await page.getByRole('combobox', { name: 'Chair' }).selectOption({ label: chair });
  await page.getByRole('combobox', { name: 'Supervisor' }).selectOption({ label: prof });
  await page.getByLabel('End').fill('10:00');
  await page.getByLabel('Patient (file number)').fill(patient.data!.file_no);
  await page.getByRole('combobox', { name: `Role of ${delegate}` }).selectOption('placing');
  await page.getByRole('button', { name: 'Book surgery' }).click();
  await expect(page).toHaveURL(new RegExp(`/schedule\\?date=${date}`));
  await expect(page.getByText(`Supervisor: ${prof}`)).toBeVisible();
});

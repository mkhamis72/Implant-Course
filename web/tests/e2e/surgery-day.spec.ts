import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, enroll, randomFutureDate, seedChair, seedCourse, seedDelegate } from './api';

test('adds a surgery day from the Schedule page and books a surgery into it', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const admin = await apiAs(TEST_USERS.admin.email);
  const day = randomFutureDate();
  const chair = uniqueName('Chair');
  await seedChair(admin, chair);
  const course = uniqueName('Course');
  const courseId = await seedCourse(api, { name: course, start: day, end: day });
  const placing = uniqueName('Dr Place');
  await enroll(api, courseId, await seedDelegate(api, placing));
  const title = uniqueName('Surgery day');

  await login(page, TEST_USERS.organizer.email);
  await createPatientViaUi(page, { full_name: uniqueName('Surgery Day Patient'), file_no: `E2E-SD${Date.now()}` });
  const fileNo = (await page.getByTestId('patient-header').innerText()).match(/File (\S+)/)![1];

  await page.goto(`/schedule?date=${day}`);
  const strip = page.getByRole('region', { name: 'Surgery sessions' });
  const form = strip.locator('details');
  if (!(await form.evaluate((d) => (d as HTMLDetailsElement).open))) await form.locator('summary').click();
  await strip.getByRole('combobox', { name: 'Course' }).selectOption({ label: course });
  await strip.getByRole('textbox', { name: 'Session title' }).fill(title);
  await strip.getByLabel('Room (optional)').fill('Clinic 2');
  await strip.getByRole('button', { name: 'Add surgery day' }).click();

  const row = strip.getByRole('listitem').filter({ hasText: title });
  await expect(row).toContainText('08:00–17:00 · Clinic 2');
  await expect(row.getByRole('link', { name: course })).toHaveAttribute('href', `/courses/${courseId}`);
  await row.getByRole('link', { name: 'Book a surgery' }).click();

  await expect(page).toHaveURL(/\/schedule\/new\?session=/);
  const session = page.getByLabel('Surgery session');
  await expect(session.locator('option:checked')).toContainText(title);
  await page.getByLabel('Chair').selectOption({ label: chair });
  await page.getByLabel('Start').fill('09:00');
  await page.getByLabel('End').fill('10:00');
  await page.getByLabel('Patient (file number)').fill(fileNo);
  await page.getByLabel(`Role of ${placing}`).selectOption('placing');
  await page.getByLabel('Tooth 1').fill('46');
  await page.getByRole('combobox', { name: 'Technique 1' }).selectOption({ label: 'Guided' });
  await page.getByRole('button', { name: 'Book surgery' }).click();
  await expect(page).toHaveURL(new RegExp(`/schedule\\?date=${day}`));
  await expect(page.getByTestId(`booking-${fileNo}`)).toContainText('09:00–10:00');
});

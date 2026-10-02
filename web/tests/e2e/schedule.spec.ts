import { test, expect, type Page } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';
import { apiAs, enroll, randomFutureDate, seedChair, seedCourse, seedDelegate, seedSession } from './api';

async function world() {
  const api = await apiAs(TEST_USERS.organizer.email);
  const admin = await apiAs(TEST_USERS.admin.email);
  const day = randomFutureDate();
  const chair = uniqueName('Chair');
  await seedChair(admin, chair);
  const courseId = await seedCourse(api, { name: uniqueName('Course'), start: day, end: day });
  const session = uniqueName('Surgery day');
  await seedSession(api, { courseId, type: 'surgery', title: session, date: day });
  const placing = uniqueName('Dr Place');
  const assisting = uniqueName('Dr Assist');
  await enroll(api, courseId, await seedDelegate(api, placing));
  await enroll(api, courseId, await seedDelegate(api, assisting));
  return { day, chair, session, placing, assisting };
}

async function fillBooking(page: Page, w: Awaited<ReturnType<typeof world>>, fileNo: string, start: string, end: string) {
  await page.goto(`/schedule/new?date=${w.day}`);
  const session = page.getByLabel('Surgery session');
  const value = await session.locator('option', { hasText: w.session }).getAttribute('value');
  await session.selectOption(value!);
  await page.getByLabel('Chair').selectOption({ label: w.chair });
  await page.getByLabel('Start').fill(start);
  await page.getByLabel('End').fill(end);
  await page.getByLabel('Patient (file number)').fill(fileNo);
  await page.getByLabel(`Role of ${w.placing}`).selectOption('placing');
  await page.getByLabel('Tooth 1').fill('36');
}

test('books a surgery that plans the implant and shows on the day view', async ({ page }) => {
  const w = await world();
  await login(page, TEST_USERS.organizer.email);
  const patientId = await createPatientViaUi(page, { full_name: uniqueName('Booked'), file_no: `E2E-B${Date.now()}` });
  const fileNo = (await page.getByTestId('patient-header').innerText()).match(/File (\S+)/)![1];
  await fillBooking(page, w, fileNo, '09:00', '10:30');
  await page.getByLabel(`Role of ${w.assisting}`).selectOption('assisting');
  await page.getByRole('button', { name: 'Book surgery' }).click();
  await expect(page).toHaveURL(new RegExp(`/schedule\\?date=${w.day}`));
  const card = page.getByTestId(`booking-${fileNo}`);
  await expect(card).toContainText('09:00–10:30');
  await expect(card).toContainText(w.placing);
  await expect(card).toContainText('36');
  await page.goto(`/patients/${patientId}`);
  await expect(page.getByRole('button', { name: 'Tooth 36, Implant planned' })).toBeVisible();
});

test('warns about a clash and books only with a reason', async ({ page }) => {
  const w = await world();
  await login(page, TEST_USERS.organizer.email);
  await createPatientViaUi(page, { full_name: uniqueName('First'), file_no: `E2E-F${Date.now()}` });
  const first = (await page.getByTestId('patient-header').innerText()).match(/File (\S+)/)![1];
  await fillBooking(page, w, first, '09:00', '10:00');
  await page.getByRole('button', { name: 'Book surgery' }).click();
  await expect(page).toHaveURL(/\/schedule\?date=/);

  await createPatientViaUi(page, { full_name: uniqueName('Second'), file_no: `E2E-S${Date.now()}` });
  const second = (await page.getByTestId('patient-header').innerText()).match(/File (\S+)/)![1];
  await fillBooking(page, w, second.toLowerCase(), '09:30', '10:30');
  await page.getByRole('button', { name: 'Book surgery' }).click();
  const warnings = page.getByTestId('clash-warnings');
  await expect(warnings).toBeVisible();
  // Warnings belong to the times they were checked for.
  await page.getByLabel('Start').fill('09:45');
  await expect(warnings).toBeHidden();
  await page.getByLabel('Start').fill('09:30');
  await page.getByRole('button', { name: 'Book surgery' }).click();
  await expect(warnings).toContainText(`${w.chair} is already booked 09:00–10:00`);
  await expect(warnings).toContainText(`${w.placing} is already booked 09:00–10:00`);
  await page.getByLabel('Reason to book anyway').fill('Two surgeons share the chair');
  await page.getByRole('button', { name: 'Book anyway' }).click();
  await expect(page).toHaveURL(/\/schedule\?date=/);
  await expect(page.getByTestId(`booking-${second}`)).toContainText('Overridden: Two surgeons share the chair');
});

test('cancels a booking with a reason', async ({ page }) => {
  const w = await world();
  await login(page, TEST_USERS.organizer.email);
  await createPatientViaUi(page, { full_name: uniqueName('Cancel'), file_no: `E2E-C${Date.now()}` });
  const fileNo = (await page.getByTestId('patient-header').innerText()).match(/File (\S+)/)![1];
  await fillBooking(page, w, fileNo, '11:00', '12:00');
  await page.getByRole('button', { name: 'Book surgery' }).click();
  const card = page.getByTestId(`booking-${fileNo}`);
  await card.getByText('Cancel booking').click();
  await card.getByLabel('Reason').fill('Patient has a fever');
  await card.getByRole('button', { name: 'Cancel surgery' }).click();
  await expect(card).toContainText('Cancelled: Patient has a fever');
});

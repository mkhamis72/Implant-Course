import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { uniqueName } from './patients';
import { apiAs, randomFutureDate, seedCourse, seedLecturer, seedSession } from './api';

test('organizer adds, edits and deletes a talk in a lecture session', async ({ page }) => {
  const admin = await apiAs(TEST_USERS.admin.email);
  const lecturer = uniqueName('Lecturer');
  const lecturer2 = uniqueName('Lecturer');
  await seedLecturer(admin, lecturer);
  await seedLecturer(admin, lecturer2);
  const api = await apiAs(TEST_USERS.organizer.email);
  const date = randomFutureDate();
  const courseId = await seedCourse(api, { name: uniqueName('Course'), start: date, end: date });
  const sessionId = await seedSession(api, { courseId, type: 'lecture', title: 'Morning lectures', date, start: '09:00', end: '13:00', room: 'Hall A' });

  await login(page, TEST_USERS.organizer.email);
  await page.goto(`/schedule/lectures?date=${date}`);
  const card = page.getByTestId(`talk-session-${sessionId}`);
  await expect(card).toContainText('Hall A');
  await expect(card).toContainText('09:00–13:00');

  await card.getByRole('link', { name: 'Add talk' }).click();
  await page.getByLabel('Start').fill('09:00');
  await page.getByLabel('End').fill('10:00');
  await page.getByRole('combobox', { name: 'Lecturer' }).selectOption({ label: lecturer });
  await page.getByLabel('Topic').fill('Sinus lift basics');
  await page.getByRole('button', { name: 'Save talk' }).click();
  await expect(page).toHaveURL(new RegExp(`/schedule/lectures\\?date=${date}`));
  await expect(card).toContainText('Sinus lift basics');
  await expect(card).toContainText(lecturer);

  // An overlap is refused and the typed values survive.
  await card.getByRole('link', { name: 'Add talk' }).click();
  await page.getByLabel('Start').fill('09:30');
  await page.getByLabel('End').fill('10:30');
  await page.getByRole('combobox', { name: 'Lecturer' }).selectOption({ label: lecturer2 });
  await page.getByLabel('Topic').fill('Flap design');
  await page.getByRole('button', { name: 'Save talk' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Another talk in this session overlaps' })).toBeVisible();
  await expect(page.getByLabel('Topic')).toHaveValue('Flap design');
  await page.getByLabel('Start').fill('10:00');
  await page.getByLabel('End').fill('11:00');
  await page.getByRole('button', { name: 'Save talk' }).click();
  await expect(card).toContainText('Flap design');

  await card.getByRole('link', { name: 'Edit Sinus lift basics' }).click();
  await page.getByLabel('Topic').fill('Sinus lift: crestal approach');
  await page.getByRole('button', { name: 'Save talk' }).click();
  await expect(card).toContainText('Sinus lift: crestal approach');

  const talk = card.getByTestId(/^talk-/).filter({ hasText: 'Flap design' });
  await talk.getByText('Delete', { exact: true }).click();
  await talk.getByRole('button', { name: 'Delete talk' }).click();
  await expect(card).not.toContainText('Flap design');
});

test('a talk stays editable after its lecturer is deactivated', async ({ page }) => {
  const admin = await apiAs(TEST_USERS.admin.email);
  const lecturer = uniqueName('Lecturer');
  const lecturerId = await seedLecturer(admin, lecturer);
  const api = await apiAs(TEST_USERS.organizer.email);
  const date = randomFutureDate();
  const courseId = await seedCourse(api, { name: uniqueName('Course'), start: date, end: date });
  const sessionId = await seedSession(api, { courseId, type: 'lecture', title: 'Morning lectures', date, start: '09:00', end: '13:00' });
  const { data: talkId, error } = await api.rpc('create_talk', {
    p_session: sessionId, p_start: '09:00', p_end: '10:00', p_lecturer: lecturerId, p_topic: 'Guided surgery',
  });
  if (error) throw error;
  const off = await admin.from('lecturers').update({ active: false }).eq('id', lecturerId);
  if (off.error) throw off.error;

  await login(page, TEST_USERS.organizer.email);
  await page.goto(`/schedule/lectures/${talkId}/edit`);
  await expect(page.getByRole('combobox', { name: 'Lecturer' })).toHaveValue(lecturerId);
  await page.getByLabel('Topic').fill('Guided surgery: planning');
  await page.getByRole('button', { name: 'Save talk' }).click();
  const card = page.getByTestId(`talk-session-${sessionId}`);
  await expect(card).toContainText('Guided surgery: planning');
  await expect(card).toContainText(lecturer);
});

test('past sessions offer no Add talk link', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const day = new Date(Date.UTC(2015, 0, 1) + Math.floor(Math.random() * 365 * 4) * 86400000).toISOString().slice(0, 10);
  const courseId = await seedCourse(api, { name: uniqueName('Course'), start: day, end: day });
  const sessionId = await seedSession(api, { courseId, type: 'lecture', title: 'Old lectures', date: day });
  await login(page, TEST_USERS.organizer.email);
  await page.goto(`/schedule/lectures?date=${day}`);
  const card = page.getByTestId(`talk-session-${sessionId}`);
  await expect(card).toContainText('Old lectures');
  await expect(card.getByRole('link', { name: 'Add talk' })).toHaveCount(0);
  await expect(card).toContainText('Past session');
});

test('schedule tabs reach the workshops day view', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  await page.goto('/schedule?date=2099-01-05');
  await page.getByRole('navigation', { name: 'Schedule sections' }).getByRole('link', { name: 'Workshops' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Workshops');
  await expect(page.getByText('No workshop sessions on this day')).toBeVisible();
});

test('admin adds, renames and deactivates a lecturer', async ({ page }) => {
  await login(page, TEST_USERS.admin.email);
  await page.goto('/admin/lecturers');
  const name = uniqueName('Lecturer');
  await page.getByLabel('New lecturer').fill(name);
  await page.getByRole('button', { name: 'Add lecturer' }).click();
  const row = page.getByTestId(`lecturer-row-${name}`);
  await expect(row).toBeVisible();
  await row.getByLabel('Name').fill(`${name} B`);
  await row.getByLabel('Active').uncheck();
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId(`lecturer-row-${name} B`)).toContainText('Inactive');
});

test('organizers cannot open lecturer settings', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  await page.goto('/admin/lecturers');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
});

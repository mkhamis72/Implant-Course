import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { uniqueName } from './patients';
import { apiAs, randomFutureDate, seedDelegate } from './api';

test('creates a course, adds a surgery session and enrolls a delegate', async ({ page }) => {
  const api = await apiAs(TEST_USERS.organizer.email);
  const delegate = uniqueName('Dr Enrol');
  await seedDelegate(api, delegate);
  const day = randomFutureDate();
  const name = uniqueName('Course');

  await login(page, TEST_USERS.organizer.email);
  await page.getByRole('link', { name: 'Courses' }).click();
  await page.getByLabel('Course name').fill(name);
  await page.getByLabel('Start date').fill(day);
  await page.getByLabel('End date').fill(day);
  await page.getByLabel('Venue').fill('Cairo Training Centre');
  await page.getByRole('button', { name: 'Create course' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

  await page.getByLabel('Session title').fill('Live surgery day');
  await page.getByLabel('Session type').selectOption('surgery');
  await page.getByLabel('Session date').fill(day);
  await page.getByLabel('Starts').fill('08:00');
  await page.getByLabel('Ends').fill('16:00');
  await page.getByRole('button', { name: 'Add session' }).click();
  await expect(page.getByTestId('session-row')).toContainText('Live surgery day');
  await expect(page.getByTestId('session-row')).toContainText('Surgery');

  await page.getByLabel('Delegate to enrol').selectOption({ label: delegate });
  await page.getByRole('button', { name: 'Enrol' }).click();
  const enrolled = page.getByTestId(`enrolled-${delegate}`);
  await expect(enrolled).toBeVisible();
  await enrolled.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByTestId(`enrolled-${delegate}`)).toHaveCount(0);
});

test('a session outside the course dates is refused', async ({ page }) => {
  const day = randomFutureDate();
  await login(page, TEST_USERS.organizer.email);
  await page.goto('/courses');
  await page.getByLabel('Course name').fill(uniqueName('Short'));
  await page.getByLabel('Start date').fill(day);
  await page.getByLabel('End date').fill(day);
  await page.getByRole('button', { name: 'Create course' }).click();
  await page.getByLabel('Session title').fill('Too late');
  await page.getByLabel('Session date').fill('2036-01-01');
  await page.getByLabel('Starts').fill('08:00');
  await page.getByLabel('Ends').fill('09:00');
  await page.getByRole('button', { name: 'Add session' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('The session date must fall within the course dates.');
});

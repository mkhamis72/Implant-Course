import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { uniqueName } from './patients';

test('creates a template by pasting text, then edits it', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  await page.getByRole('link', { name: 'Checklists' }).click();
  await page.getByRole('link', { name: 'Templates' }).click();
  await page.getByRole('link', { name: 'New template' }).click();
  const name = uniqueName('Template');
  await page.getByLabel('Template name').fill(name);
  await page.getByRole('combobox', { name: 'Used for', exact: true }).selectOption('lecture');
  await page.getByLabel('Items (one per line)').fill('- Projector tested\n\n2. Handouts printed\n[ ] Attendance sheet');
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page.getByTestId('template-item')).toHaveText(['Projector tested', 'Handouts printed', 'Attendance sheet']);
  await page.getByLabel('Items (one per line)').fill('Projector tested\nMicrophone charged');
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByTestId('template-item')).toHaveText(['Projector tested', 'Microphone charged']);
});

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

test('creates a checklist by pasting, two organizers tick and untick with attribution', async ({ browser }) => {
  const a = await browser.newPage();
  const b = await browser.newPage();
  await login(a, TEST_USERS.organizer.email);
  await login(b, TEST_USERS.admin.email);

  await a.goto('/checklists');
  const title = uniqueName('Checklist');
  await a.getByLabel('Title').fill(title);
  await a.getByLabel('Items (one per line)').fill('* Implants counted\n* Motor charged\n* Consent forms printed');
  await a.getByRole('button', { name: 'Create checklist' }).click();
  await expect(a.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(a.getByTestId('checklist-progress')).toHaveText('0/3 done');

  await a.getByRole('checkbox', { name: 'Motor charged' }).check();
  await expect(a.getByTestId('checklist-item').nth(1)).toContainText(/✓ Test Organizer · \d\d:\d\d/);
  await expect(a.getByTestId('checklist-progress')).toHaveText('1/3 done');

  await b.goto(a.url());
  await expect(b.getByRole('checkbox', { name: 'Motor charged' })).toBeChecked();
  await expect(b.getByTestId('checklist-item').nth(1)).toContainText('✓ Test Organizer');
  await b.getByRole('checkbox', { name: 'Motor charged' }).uncheck();
  await expect(b.getByTestId('checklist-progress')).toHaveText('0/3 done');
  await expect(b.getByTestId('checklist-item').nth(1)).not.toContainText('✓');

  await a.reload();
  await expect(a.getByRole('checkbox', { name: 'Motor charged' })).not.toBeChecked();
  await a.close();
  await b.close();
});

test('adds, edits, assigns, reorders and deletes items; "Mine" lists my open items', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  await page.goto('/checklists');
  const title = uniqueName('Edit list');
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Items (one per line)').fill('First\nSecond');
  await page.getByRole('button', { name: 'Create checklist' }).click();

  await page.getByLabel('Add items (one per line)').fill('Third');
  await page.getByRole('button', { name: 'Add items' }).click();
  await expect(page.getByTestId('checklist-item')).toHaveCount(3);

  const third = page.getByTestId('checklist-item').nth(2);
  await third.getByRole('button', { name: 'Move up' }).click();
  await expect(page.getByTestId('checklist-item').nth(1)).toContainText('Third');

  const edited = uniqueName('Third edited');
  const item = page.getByTestId('checklist-item').nth(1);
  await item.getByRole('button', { name: 'Edit' }).click();
  await item.getByLabel('Item text').fill(edited);
  await item.getByRole('combobox', { name: 'Assigned to', exact: true }).selectOption({ label: 'Test Organizer' });
  await item.getByLabel('Due date').fill('2031-01-15');
  await item.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('checklist-item').nth(1)).toContainText(edited);
  await expect(page.getByTestId('checklist-item').nth(1)).toContainText('Test Organizer');

  await page.goto('/checklists?view=mine');
  await expect(page.getByTestId('my-item').filter({ hasText: edited })).toBeVisible();

  await page.getByTestId('my-item').filter({ hasText: edited }).getByRole('link').click();
  await page.getByTestId('checklist-item').first().getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('checklist-item')).toHaveCount(2);
});

test('pasting nothing is refused with a clear message', async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
  await page.goto('/checklists');
  await page.getByLabel('Title').fill(uniqueName('Empty'));
  await page.getByLabel('Items (one per line)').fill('\n  \n- \n');
  await page.getByRole('button', { name: 'Create checklist' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Add at least one item (one per line) or choose a template.');
});

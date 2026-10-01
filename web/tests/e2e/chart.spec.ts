import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import { pgConfig } from '../../scripts/db';
import { TEST_USERS } from '../support/test-users';
import { login } from './helpers';
import { createPatientViaUi, uniqueName } from './patients';

test.beforeEach(async ({ page }) => {
  await login(page, TEST_USERS.organizer.email);
});

test('marks a tooth missing and it stays missing', async ({ page }) => {
  const id = await createPatientViaUi(page, { full_name: uniqueName('Chart') });
  await page.getByRole('button', { name: 'Tooth 36, Present' }).click();
  const panel = page.getByRole('complementary', { name: 'Tooth details' });
  await expect(panel.getByRole('heading', { name: 'Tooth 36' })).toBeVisible();
  await panel.getByRole('button', { name: 'Mark missing' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 36, Missing' })).toBeVisible();
  await page.goto(`/patients/${id}`);
  await expect(page.getByRole('button', { name: 'Tooth 36, Missing' })).toBeVisible();
});

test('bulk-marks several teeth with shift-click', async ({ page }) => {
  await createPatientViaUi(page, { full_name: uniqueName('Bulk') });
  await page.getByRole('button', { name: 'Tooth 36, Present' }).click();
  await page.getByRole('button', { name: 'Tooth 46, Present' }).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Tooth 18, Present' }).click({ modifiers: ['Control'] });
  const panel = page.getByRole('complementary', { name: 'Tooth details' });
  await expect(panel.getByRole('heading', { name: '3 teeth: 18, 36, 46' })).toBeVisible();
  await panel.getByRole('button', { name: 'Mark extracted' }).click();
  for (const tooth of [18, 36, 46]) {
    await expect(page.getByRole('button', { name: `Tooth ${tooth}, Extracted` })).toBeVisible();
  }
});

test('?tooth= pre-selects a tooth', async ({ page }) => {
  const id = await createPatientViaUi(page, { full_name: uniqueName('Deep link') });
  await page.goto(`/patients/${id}?tooth=24`);
  await expect(page.getByRole('button', { name: 'Tooth 24, Present' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('complementary', { name: 'Tooth details' }).getByRole('heading', { name: 'Tooth 24' })).toBeVisible();
});

test('implant teeth are locked in the panel', async ({ page }) => {
  const id = await createPatientViaUi(page, { full_name: uniqueName('Locked') });
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    await pg.query("insert into public.tooth_status (patient_id, tooth, status) values ($1, 46, 'implant_placed')", [id]);
  } finally {
    await pg.end();
  }
  await page.goto(`/patients/${id}?tooth=46`);
  const panel = page.getByRole('complementary', { name: 'Tooth details' });
  await expect(panel).toContainText('Teeth with implant records (46) are changed from the implant workflow, not here.');
  await expect(panel.getByRole('button', { name: /^Mark / })).toHaveCount(0);
});

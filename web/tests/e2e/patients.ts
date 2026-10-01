import { expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import { pgConfig } from '../../scripts/db';

export const E2E_PREFIX = 'E2E ';

export function uniqueName(label: string): string {
  return `${E2E_PREFIX}${label} ${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

export async function createPatientViaUi(
  page: Page,
  fields: { full_name: string; phone?: string; dob?: string; file_no?: string },
): Promise<string> {
  await page.goto('/patients/new');
  await page.getByLabel('Full name').fill(fields.full_name);
  if (fields.file_no) await page.getByLabel('File number').fill(fields.file_no);
  if (fields.dob) await page.getByLabel('Date of birth').fill(fields.dob);
  if (fields.phone) await page.getByLabel('Phone').fill(fields.phone);
  await page.getByRole('button', { name: 'Save patient' }).click();
  await page.waitForURL(/\/patients\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: fields.full_name })).toBeVisible();
  return new URL(page.url()).pathname.split('/').pop()!;
}

/** E2E patients are real rows in the dev project; remove them (as postgres) after the run. */
export async function deleteE2ePatients(): Promise<void> {
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    await pg.query(`delete from public.patients where full_name like $1`, [`${E2E_PREFIX}%`]);
  } finally {
    await pg.end();
  }
}

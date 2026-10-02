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

/**
 * E2E rows live in the dev project. Patients with stock movements stay (the ledger is immutable);
 * E2E catalog items and delegates are deactivated (they are referenced by the ledger).
 */
export async function deleteE2ePatients(): Promise<void> {
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    await pg.query(
      `delete from public.patients p where p.full_name like $1
       and not exists (select 1 from public.stock_movements m where m.patient_id = p.id)
       and not exists (select 1 from public.implant_sites s
                       join public.stock_movements m on m.implant_site_id = s.id where s.patient_id = p.id)`,
      [`${E2E_PREFIX}%`],
    );
  } finally {
    await pg.end();
  }
}

/** E2E checklists and templates (items cascade), so test users' "my open items" don't pile up between runs. */
export async function deleteE2eChecklists(): Promise<void> {
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    await pg.query('delete from public.checklists where title like $1', [`${E2E_PREFIX}%`]);
    await pg.query('delete from public.checklist_items where text like $1', [`${E2E_PREFIX}%`]);
    await pg.query('delete from public.checklist_templates where name like $1', [`${E2E_PREFIX}%`]);
  } finally {
    await pg.end();
  }
}

export async function deactivateE2eCatalog(): Promise<void> {
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    await pg.query('update public.products set active = false where brand like $1 and active', [`${E2E_PREFIX}%`]);
    await pg.query('update public.delegates set active = false where full_name like $1 and active', [`${E2E_PREFIX}%`]);
    await pg.query('update public.chairs set active = false where name like $1 and active', [`${E2E_PREFIX}%`]);
  } finally {
    await pg.end();
  }
}

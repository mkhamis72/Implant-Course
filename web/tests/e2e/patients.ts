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
 * Every E2E patient goes, with its implants, components and their stock movements, the way
 * `delete_patient` (0099) removes a mistaken patient (the stock returns); left behind they slow the
 * Statistics readers on the local stack. E2E catalog items and delegates are deactivated (stock receipts
 * still reference them).
 */
export async function deleteE2ePatients(): Promise<void> {
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    await pg.query('begin');
    await pg.query(
      `create temp table e2e_patients on commit drop as
       select id from public.patients where full_name like $1`,
      [`${E2E_PREFIX}%`],
    );
    await pg.query(`select set_config('app.ledger_purge', 'on', true)`);
    await pg.query(
      `delete from public.stock_movements m
       where m.patient_id in (select id from e2e_patients)
          or m.implant_site_id in (select s.id from public.implant_sites s where s.patient_id in (select id from e2e_patients))
          or m.site_component_id in (
            select sc.id from public.site_components sc
            join public.implant_sites s on s.id = sc.site_id where s.patient_id in (select id from e2e_patients))`,
    );
    await pg.query(`select set_config('app.ledger_purge', 'off', true)`);
    await pg.query(
      `delete from app_private.research_codes
       where (entity = 'patient' and entity_id in (select id from e2e_patients))
          or (entity = 'implant' and entity_id in (
                select s.id from public.implant_sites s where s.patient_id in (select id from e2e_patients)))
          or (entity = 'restoration' and entity_id in (
                select r.id from public.restorations r where r.patient_id in (select id from e2e_patients)))`,
    );
    await pg.query('delete from public.surgery_slots where patient_id in (select id from e2e_patients)');
    await pg.query('delete from public.patients where id in (select id from e2e_patients)');
    await pg.query('commit');
  } catch (e) {
    await pg.query('rollback').catch(() => {});
    throw e;
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
    await pg.query('update public.supervisors set active = false where full_name like $1 and active', [`${E2E_PREFIX}%`]);
    await pg.query('update public.lecturers set active = false where full_name like $1 and active', [`${E2E_PREFIX}%`]);
  } finally {
    await pg.end();
  }
}

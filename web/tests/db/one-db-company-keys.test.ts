import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAsBound, asPostgres } from './helpers';
import { makeCourse, makePatient, makeSession } from './fixtures';

const users = inject('testUsers');
const ACADEMY_ID = 'a7c0de00-0000-4000-8000-000000000001';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

/** Company B (as postgres), with the test admin as its active admin. */
async function companyB(c: Client): Promise<string> {
  await asPostgres(c);
  const b = (await c.query(`insert into public.companies (slug, name) values ('zz-company-keys', 'Zz B') returning id`)).rows[0].id;
  await c.query(`insert into public.company_members (company_id, user_id, role, active) values ($1, $2, 'admin', true)`,
    [b, users.admin]);
  return b;
}

/** Release 5 (0095) drops the global uniques that 0091 replaces; until then a test drops them in its transaction. */
async function dropGlobalUniques(c: Client): Promise<void> {
  await c.query('alter table public.patients drop constraint patients_file_no_key');
  await c.query('drop index public.patients_file_no_upper_key');
  await c.query('alter table public.chairs drop constraint chairs_name_key');
  await c.query('alter table public.consent_form_versions drop constraint consent_form_versions_label_key');
  await c.query('drop index public.checklist_templates_one_default');
}

describe('company keys (0091)', () => {
  it('lets two companies reuse a file number, chair name, form label and default template, but not one company', async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      await dropGlobalUniques(c);
      for (const company of [ACADEMY_ID, b]) {
        await c.query(`insert into public.patients (company_id, full_name, file_no) values ($1, 'Zz Keys Patient', 'ZZ-001')`, [company]);
        await c.query(`insert into public.chairs (company_id, name) values ($1, 'Zz Chair 1')`, [company]);
        await c.query(`insert into public.consent_form_versions (company_id, label, effective_on, text_en, text_ar)
          values ($1, 'Zz v1', '2030-01-01', 'Consent text', 'نص')`, [company]);
        await c.query(`update public.checklist_templates set is_default = false where company_id = $1 and applies_to = 'surgery'`, [company]);
        await c.query(`insert into public.checklist_templates (company_id, name, applies_to, is_default)
          values ($1, 'Zz Default', 'surgery', true)`, [company]);
      }
      await refused(c, () => c.query(
        `insert into public.patients (company_id, full_name, file_no) values ($1, 'Zz Keys Twin', 'zz-001')`, [b]), /patients_company_file_no_key/);
      await refused(c, () => c.query(
        `insert into public.chairs (company_id, name) values ($1, 'Zz Chair 1')`, [b]), /chairs_company_name_key/);
      await refused(c, () => c.query(`insert into public.consent_form_versions (company_id, label, effective_on, text_en, text_ar)
        values ($1, 'Zz v1', '2030-01-01', 'Consent text', 'نص')`, [b]), /consent_form_versions_company_label_key/);
      await refused(c, () => c.query(`insert into public.checklist_templates (company_id, name, applies_to, is_default)
        values ($1, 'Zz Default 2', 'surgery', true)`, [b]), /checklist_templates_company_one_default/);
    });
  });

  it('numbers patient files within the bound company', async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      await dropGlobalUniques(c);
      await actAsBound(c, users.admin, b);
      expect((await c.query('select public.next_file_no() as n')).rows[0].n).toBe('P00001');
      await asPostgres(c);
      await c.query(`insert into public.patients (company_id, full_name, file_no) values ($1, 'Zz Keys Patient', 'P00001')`, [b]);
      await actAsBound(c, users.admin, b);
      expect((await c.query('select public.next_file_no() as n')).rows[0].n).toBe('P00002');
      await actAsBound(c, users.admin, ACADEMY_ID);
      const academyNext = (await c.query('select public.next_file_no() as n')).rows[0].n as string;
      await asPostgres(c);
      expect((await c.query(`select count(*)::int as n from public.patients where company_id = $1 and upper(file_no) = $2`,
        [ACADEMY_ID, academyNext])).rows[0].n).toBe(0);
    });
  });

  it("refuses an academy slot on a B chair", async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      const course = await makeCourse(c);
      const session = await makeSession(c, course);
      const patient = await makePatient(c, 'Zz Keys Slot Patient');
      const supervisor = (await c.query("insert into public.supervisors (full_name) values ('Zz Keys Prof') returning id")).rows[0].id;
      const chair = (await c.query(`insert into public.chairs (company_id, name) values ($1, 'Zz B Chair') returning id`, [b])).rows[0].id;
      await refused(c, () => c.query(
        `insert into public.surgery_slots (session_id, chair_id, starts_at, ends_at, patient_id, supervisor_id)
         values ($1, $2, '2030-03-02 09:00', '2030-03-02 10:00', $3, $4)`, [session, chair, patient, supervisor]),
      /surgery_slots_chair_id_fkey/);
    });
  });

  it('keeps one settings row per company', async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      await c.query('insert into public.settings (company_id) values ($1)', [b]);
      const { rows } = await c.query(
        'select company_id, count(*)::int as n from public.settings where company_id = any($1) group by company_id order by company_id',
        [[ACADEMY_ID, b]]);
      expect(rows.map((r) => r.n)).toEqual([1, 1]);
      await refused(c, () => c.query('insert into public.settings (company_id) values ($1)', [b]), /settings_pkey/);
    });
  });

  it("writes branding for the bound company only", async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      const before = (await c.query('select name, logo_version from public.branding where company_id = $1', [ACADEMY_ID])).rows[0];
      await actAsBound(c, users.admin, b);
      await c.query(`select public.update_branding('Zz B Brand', '#112233', null)`);
      await c.query(`select public.set_branding_logo($1, 'image/png')`, [PNG]);
      await asPostgres(c);
      expect((await c.query('select name, brand_color, logo_version from public.branding where company_id = $1', [b])).rows)
        .toEqual([{ name: 'Zz B Brand', brand_color: '#112233', logo_version: 1 }]);
      expect((await c.query('select count(*)::int as n from public.branding_logos where company_id = $1', [b])).rows[0].n).toBe(1);
      expect((await c.query('select name, logo_version from public.branding where company_id = $1', [ACADEMY_ID])).rows[0])
        .toEqual(before);
      // The previous version's reader keeps serving academy alone.
      expect((await c.query('select name, logo_version from public.branding_public()')).rows).toEqual([before]);

      const academyLogos = (await c.query('select count(*)::int as n from public.branding_logos where company_id = $1', [ACADEMY_ID])).rows[0].n;
      await actAsBound(c, users.admin, b);
      await c.query('select public.clear_branding_logo()');
      await asPostgres(c);
      expect((await c.query('select count(*)::int as n from public.branding_logos where company_id = $1', [b])).rows[0].n).toBe(0);
      expect((await c.query('select logo_version from public.branding where company_id = $1', [b])).rows[0].logo_version).toBe(2);
      expect((await c.query('select count(*)::int as n from public.branding_logos where company_id = $1', [ACADEMY_ID])).rows[0].n)
        .toBe(academyLogos);
      expect((await c.query('select name, logo_version from public.branding where company_id = $1', [ACADEMY_ID])).rows[0])
        .toEqual(before);
    });
  });
});

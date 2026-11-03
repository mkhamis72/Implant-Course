import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAsBound, asCompany, asPostgres } from './helpers';
import { makeCourse, makeSession } from './fixtures';

const users = inject('testUsers');
const ACADEMY_ID = 'a7c0de00-0000-4000-8000-000000000001';

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

/** Company B (as postgres), with the test admin as its active admin. */
async function companyB(c: Client): Promise<string> {
  await asPostgres(c);
  const b = (await c.query(`insert into public.companies (slug, name) values ('zz-company-policies', 'Zz B') returning id`)).rows[0].id;
  await c.query(`insert into public.company_members (company_id, user_id, role, active) values ($1, $2, 'admin', true)`,
    [b, users.admin]);
  return b;
}

/** An academy patient, written by a fixture session bound to academy. */
async function academyPatient(c: Client): Promise<string> {
  await asCompany(c);
  return (await c.query(`insert into public.patients (full_name, file_no)
    values ('Zz Policies Patient', 'ZZP' || substr(md5(random()::text), 1, 8)) returning id`)).rows[0].id;
}

describe('company policies (0092)', () => {
  it('a session bound to B sees no academy rows, writes B rows by default and cannot write academy rows (column grants refuse company_id first)', async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      const patient = await academyPatient(c);
      await actAsBound(c, users.admin, b);
      expect((await c.query('select 1 from public.patients where id = $1', [patient])).rows).toEqual([]);
      expect((await c.query('select count(*)::int as n from public.patients where company_id <> $1', [b])).rows[0].n).toBe(0);
      const mine = (await c.query(`insert into public.chairs (name) values ('Zz B Policies Chair') returning company_id`)).rows[0];
      expect(mine.company_id).toBe(b);
      await refused(c, () => c.query(`insert into public.chairs (company_id, name) values ($1, 'Zz Planted Chair')`, [ACADEMY_ID]),
        /permission denied for table chairs|chairs_company_insert/);
      await refused(c, () => c.query(`update public.chairs set company_id = $1 where name = 'Zz B Policies Chair'`, [ACADEMY_ID]),
        /permission denied for table chairs|chairs_company_update/);
      // Inside a definer (tenant_definer, which has every column grant) the restrictive policies refuse it.
      await c.query('reset role');
      await c.query('set local role tenant_definer');
      expect((await c.query('select 1 from public.patients where id = $1', [patient])).rows).toEqual([]);
      await refused(c, () => c.query(`insert into public.chairs (company_id, name) values ($1, 'Zz Planted Chair')`, [ACADEMY_ID]),
        /row-level security policy "chairs_company_insert"/);
      await refused(c, () => c.query(`update public.chairs set company_id = $1 where name = 'Zz B Policies Chair'`, [ACADEMY_ID]),
        /row-level security policy "chairs_company_update"/);
    });
  });

  it('a definer handed another company\'s id finds nothing (tenant_definer)', async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      const patient = await academyPatient(c);
      await actAsBound(c, users.admin, b);
      await refused(c, () => c.query('select public.delete_patient($1)', [patient]), /not found/i);
      await asPostgres(c);
      expect((await c.query('select 1 from public.patients where id = $1', [patient])).rows).toHaveLength(1);
    });
  });

  it('logs each row in its company, and only that company reads it', async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      await actAsBound(c, users.admin, b);
      const chair = (await c.query(`insert into public.chairs (name) values ('Zz B Audit Chair') returning id`)).rows[0].id;
      await asPostgres(c);
      expect((await c.query(`select company_id from public.audit_log where table_name = 'chairs' and row_id = $1`, [chair])).rows)
        .toEqual([{ company_id: b }]);
      await actAsBound(c, users.admin);
      expect((await c.query(`select 1 from public.audit_log where table_name = 'chairs' and row_id = $1`, [chair])).rows).toEqual([]);
    });
  });

  it('keeps two companies\' default templates and consent labels apart (save_template, attach_default, save_consent_version, current_consent_version)', async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      // Release 5 (0095) drops the global uniques that 0091 replaced; until then the test drops them here.
      await c.query('drop index public.checklist_templates_one_default');
      await c.query('alter table public.consent_form_versions drop constraint consent_form_versions_label_key');

      await actAsBound(c, users.admin);
      const academyDefault = (await c.query(`select public.save_template(null, 'Zz Academy default', 'surgery', true, array['A item']) as id`)).rows[0].id;
      await c.query(`select public.save_consent_version(null, 'Zz v1', public.cairo_today(), 'Academy text', 'نص')`);

      await actAsBound(c, users.admin, b);
      const bDefault = (await c.query(`select public.save_template(null, 'Zz B default', 'surgery', true, array['B item']) as id`)).rows[0].id;
      await c.query(`select public.save_consent_version(null, 'Zz v1', public.cairo_today(), 'B text', 'نص')`);
      await refused(c, () => c.query(`select public.save_consent_version(null, 'Zz v1', public.cairo_today(), 'B again', 'نص')`),
        /already exists/);
      expect((await c.query('select text_en from public.current_consent_version()')).rows).toEqual([{ text_en: 'B text' }]);

      await asPostgres(c);
      expect((await c.query('select id, is_default from public.checklist_templates where id = any($1) order by name', [[academyDefault, bDefault]])).rows)
        .toEqual([{ id: academyDefault, is_default: true }, { id: bDefault, is_default: true }]);

      // A new B surgery session takes B's default template (session_checklist → attach_default).
      await asCompany(c, b, users.admin);
      const session = await makeSession(c, await makeCourse(c));
      expect((await c.query('select template_id from public.checklists where session_id = $1', [session])).rows)
        .toEqual([{ template_id: bDefault }]);

      await actAsBound(c, users.admin);
      expect((await c.query('select text_en from public.current_consent_version()')).rows).toEqual([{ text_en: 'Academy text' }]);
    });
  });

  it('profiles: staff read the people of their company and their own row, nobody writes directly', async () => {
    await withTx(async (c) => {
      const b = await companyB(c);
      await actAsBound(c, users.admin, b);
      expect((await c.query('select user_id from public.profiles')).rows).toEqual([{ user_id: users.admin }]);
      await actAsBound(c, users.admin);
      expect((await c.query('select 1 from public.profiles where user_id = $1', [users.organizer])).rows).toHaveLength(1);
      await refused(c, () => c.query(`update public.profiles set full_name = full_name where user_id = $1`, [users.organizer]),
        /permission denied/);
    });
  });
});

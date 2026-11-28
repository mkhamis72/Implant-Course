import { describe, it, expect, inject } from 'vitest';
import { Client } from 'pg';
import { withTx, actAs, actAsBound, asPostgres } from './helpers';
import { insertSelfAuthUser, pendingLogin } from './fixtures';

// Implant passport: the company's medical-content setting (0145). The stored PDFs, their file table and the
// download log went in 0152 (the passport is built in the browser since 0150; tests: passport-generations).

const users = inject('testUsers');
async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

const count = async (c: Client, sql: string, params: unknown[] = []) =>
  (await c.query(`select count(*)::int as n from (${sql}) x`, params)).rows[0].n as number;

/** Company B with an admin, bound; returns the admin's id. Leaves the caller acting as B's admin. */
async function companyB(c: Client): Promise<{ company: string; admin: string }> {
  await asPostgres(c);
  await c.query("select set_config('request.jwt.claims', '', true)");
  const tag = Math.random().toString(36).slice(2, 8);
  const company = (await c.query('insert into public.companies (slug, name) values ($1, $2) returning id',
    [`zz-pass-${tag}`, 'Zz Passport B'])).rows[0].id as string;
  const email = `zz-pass-${tag}-admin@example.com`;
  await pendingLogin(c, email, { company, role: 'admin', fullName: 'Zz Passport admin' });
  const admin = await insertSelfAuthUser(c, { email, companyId: company });
  await actAsBound(c, admin, company);
  return { company, admin };
}


describe('implant passport: settings', () => {
  it('default allergies_medications; admins only change it; per company', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      await c.query(`delete from public.passport_settings where company_id = 'a7c0de00-0000-4000-8000-000000000001'`);
      await actAs(c, users.organizer);
      const current = async () => (await c.query('select public.passport_settings_current() as v')).rows[0].v as string;
      expect(await current()).toBe('allergies_medications');
      await refused(c, () => c.query(`select public.set_passport_settings(p_medical => 'full')`), /Only an admin/);
      await refused(c, () => c.query(`update public.passport_settings set medical = 'full'`), /permission denied/);

      await actAs(c, users.admin);
      await c.query(`select public.set_passport_settings(p_medical => 'full')`);
      expect(await current()).toBe('full');
      await c.query(`select public.set_passport_settings(p_medical => 'none')`);
      expect(await current()).toBe('none');
      await refused(c, () => c.query(`select public.set_passport_settings(p_medical => 'everything')`), /medical/i);
      await refused(c, () => c.query(`select public.set_passport_settings(p_medical => null)`), /medical/i);

      await actAs(c, users.viewer);
      expect(await current()).toBe('none');

      await companyB(c);
      expect(await current()).toBe('allergies_medications');
      await c.query(`select public.set_passport_settings(p_medical => 'full')`);
      expect(await current()).toBe('full');
      await actAs(c, users.admin);
      expect(await current()).toBe('none');

      await asPostgres(c);
      expect(await count(c, `select 1 from public.audit_log where table_name = 'passport_settings'
        and row_id = 'a7c0de00-0000-4000-8000-000000000001'`)).toBeGreaterThan(0);
    });
  });
});

describe('implant passport: stored passports are gone (0152)', () => {
  it('no stored-passport tables or functions remain', async () => {
    await withTx(async (c) => {
      expect(await count(c, `select 1 from pg_class where relnamespace = 'public'::regnamespace
        and relname in ('patient_passports', 'patient_passport_files', 'passport_downloads')`)).toBe(0);
      expect(await count(c, `select 1 from pg_proc where proname in ('save_patient_passport', 'patient_passport_file')`)).toBe(0);
    });
  });
});

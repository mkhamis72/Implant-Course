import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, asPostgres, actAsBound } from './helpers';
import { provisionCompany } from '../../scripts/tenants';

const ACADEMY_ID = 'a7c0de00-0000-4000-8000-000000000001';
const users = inject('testUsers');

/** The console's call: the service role, no signed-in user and no bound session. */
async function provision(c: Client, slug: string, name: string): Promise<string> {
  await asPostgres(c);
  await c.query('set local role service_role');
  const { rows } = await c.query('select public.provision_company($1, $2) as id', [slug, name]);
  await asPostgres(c);
  return rows[0].id;
}

async function count(c: Client, sql: string, params: unknown[]): Promise<number> {
  return (await c.query(`select count(*)::int as n from ${sql}`, params)).rows[0].n;
}

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

describe('provision_company (0095)', () => {
  it("creates the company with its settings, branding, file numbers, academy's catalogue and consent versions", async () => {
    await withTx(async (c) => {
      const id = await provision(c, 'canary', 'Canary');
      expect((await c.query(`select id, name from public.companies where slug = 'canary'`)).rows).toEqual([{ id, name: 'Canary' }]);
      expect(await count(c, 'public.settings where company_id = $1', [id])).toBe(1);
      expect((await c.query('select name from public.branding where company_id = $1', [id])).rows).toEqual([{ name: 'Canary' }]);
      expect((await c.query('select last_no from app_private.file_no_counters where company_id = $1', [id])).rows).toEqual([{ last_no: 0 }]);

      const academyProducts = await count(c, 'public.products where company_id = $1 and active and not is_sample', [ACADEMY_ID]);
      expect(academyProducts).toBeGreaterThan(0);
      expect(await count(c, 'public.products where company_id = $1', [id])).toBe(academyProducts);
      // Same catalogue rows (all columns but the keys and timestamps), new ids.
      const catalogue = `select type, category, brand, system, platform, diameter_mm, length_mm, ref_code, description,
        reorder_level, active, is_sample from public.products where company_id = $1`;
      expect(await count(c, `(${catalogue} and active and not is_sample except all ${catalogue.replace('$1', '$2')}) x`, [ACADEMY_ID, id])).toBe(0);
      expect(await count(c, 'public.products p where p.company_id = $1 and exists (select 1 from public.products a where a.id = p.id and a.company_id <> $1)', [id])).toBe(0);

      const consent = 'select label, effective_on, text_en, text_ar from public.consent_form_versions where company_id = $1 order by created_at';
      const academyConsent = (await c.query(consent, [ACADEMY_ID])).rows;
      expect(academyConsent.length).toBeGreaterThan(0);
      expect((await c.query(consent, [id])).rows).toEqual(academyConsent);
      expect(await count(c, 'public.consent_form_versions where company_id = $1 and first_signed_at is not null', [id])).toBe(0);
    });
  });

  it("the new company's admin reads its own starting data", async () => {
    await withTx(async (c) => {
      const id = await provision(c, 'canary', 'Canary');
      await c.query("insert into public.company_members (company_id, user_id, role, active) values ($1, $2, 'admin', true)", [id, users.organizer]);
      await actAsBound(c, users.organizer, id);
      expect(await count(c, 'public.settings', [])).toBe(1);
      expect((await c.query('select name, has_logo from public.branding_for($1)', [id])).rows).toEqual([{ name: 'Canary', has_logo: false }]);
      expect(await count(c, 'public.products where company_id <> $1', [id])).toBe(0);
    });
  });

  it('again for a company nobody belongs to yet returns the same company (a retried registration)', async () => {
    await withTx(async (c) => {
      const id = await provision(c, 'canary', 'Canary');
      expect(await provision(c, 'canary', 'Canary')).toBe(id);
      expect(await count(c, 'public.companies where slug = $1', ['canary'])).toBe(1);
      expect(await count(c, 'public.settings where company_id = $1', [id])).toBe(1);
    });
  });

  it('refuses a slug whose company has members, and a blank name', async () => {
    await withTx(async (c) => {
      const id = await provision(c, 'canary', 'Canary');
      await c.query("insert into public.company_members (company_id, user_id, role, active) values ($1, $2, 'admin', true)", [id, users.organizer]);
      await refused(c, () => provision(c, 'canary', 'Canary Two'), /already exists/);
      await refused(c, () => provision(c, 'academy', 'Academy'), /already exists/);
      await refused(c, () => provision(c, 'zz-blank', '  '), /name/i);
      await refused(c, () => provision(c, 'Bad Slug', 'Bad'), /slug/i);
    });
  });

  it("tenant:register --provision's helper creates it over the owner's connection", async () => {
    await withTx(async (c) => {
      const id = await provisionCompany(c, 'canary', 'Canary');
      expect((await c.query(`select id from public.companies where slug = 'canary'`)).rows).toEqual([{ id }]);
    });
  });

  it('is for the service role only', async () => {
    await withTx(async (c) => {
      for (const role of ['anon', 'authenticated', 'tenant_definer']) {
        const { rows } = await c.query(`select has_function_privilege($1, 'public.provision_company(text, text)', 'execute') as ok`, [role]);
        expect({ role, ok: rows[0].ok }).toEqual({ role, ok: false });
      }
      const { rows } = await c.query(`select has_function_privilege('service_role', 'public.provision_company(text, text)', 'execute') as ok`);
      expect(rows[0].ok).toBe(true);
    });
  });
});

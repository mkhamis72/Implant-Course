import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asPostgres, asCompany } from './helpers';
import { setPerms } from './fixtures';

const users = inject('testUsers');
const ACADEMY = 'a7c0de00-0000-4000-8000-000000000001';
const FULL_PLAN = 'fa110000-0000-4000-8000-000000000001';

async function refused(c: Client, sql: string, params: unknown[], pattern: RegExp) {
  await c.query('savepoint s');
  await expect(c.query(sql, params)).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

async function provision(c: Client, slug: string, name: string): Promise<string> {
  await asPostgres(c);
  await c.query('set local role service_role');
  const { rows } = await c.query('select public.provision_company($1, $2) as id', [slug, name]);
  await asPostgres(c);
  return rows[0].id;
}

/** Puts academy on a new plan with these modules (as postgres, rolled back with the test). */
async function onPlan(c: Client, modules: string[], name = 'Zz basic'): Promise<string> {
  await asPostgres(c);
  const { rows } = await c.query(
    `insert into public.plans (name, kind, modules) values ($1, 'course_organizer', $2) returning id`, [name, modules]);
  await c.query('update public.companies set plan_id = $1 where id = $2', [rows[0].id, ACADEMY]);
  return rows[0].id;
}

async function backToFull(c: Client) {
  await asPostgres(c);
  await c.query('update public.companies set plan_id = $1 where id = $2', [FULL_PLAN, ACADEMY]);
}

const one = async (c: Client, sql: string, params: unknown[] = []) => Object.values((await c.query(sql, params)).rows[0])[0];
const count = async (c: Client, table: string) => Number(await one(c, `select count(*)::int from public.${table}`));

/** One study, one saved analysis and one export log row in academy, written by the admin on Full. */
async function seedResearch(c: Client) {
  await actAs(c, users.admin, { aal: 'aal2' });
  await c.query(`select public.save_study(null, 'Zz modules study', null, null, null, null, null, null, null, '{}')`);
  await c.query(`select public.save_analysis(null, 'Zz modules analysis', '{"version":"1","query":{}}'::jsonb, null)`);
  await asCompany(c, ACADEMY, users.admin);
  await c.query(`insert into public.research_exports (exported_by, format) values ($1, 'csv')`, [users.admin]);
}

describe('modules (0109)', () => {
  it('existing companies are on Full with every feature', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin, { aal: 'aal2' });
      const { rows } = await c.query('select * from public.my_company_plan()');
      expect(rows).toEqual([{ kind: 'course_organizer', plan_name: 'Full', features: ['inventory', 'statistics', 'teaching'] }]);
    });
  });

  it('my_company_plan is empty without a bound company', async () => {
    await withTx(async (c) => {
      await actAs(c, users.admin, { session_id: crypto.randomUUID() });
      expect((await c.query('select * from public.my_company_plan()')).rows).toEqual([]);
      expect(await one(c, `select public.module_on('inventory')`)).toBe(false);
    });
  });

  it('new company starts on Full', async () => {
    await withTx(async (c) => {
      const id = await provision(c, 'zz-modules-new', 'Zz Modules New');
      const { rows } = await c.query('select plan_id, kind, extra_modules from public.companies where id = $1', [id]);
      expect(rows).toEqual([{ plan_id: FULL_PLAN, kind: 'course_organizer', extra_modules: [] }]);
    });
  });

  it('statistics off closes it for admins and organizers', async () => {
    await withTx(async (c) => {
      await setPerms(c, users.organizer, { research: 'edit' });
      await seedResearch(c);
      const tables = ['studies', 'saved_analyses', 'research_exports'];
      const onFull: Record<string, number> = {};
      await actAs(c, users.admin, { aal: 'aal2' });
      for (const t of tables) onFull[t] = await count(c, t);
      for (const t of tables) expect(onFull[t], t).toBeGreaterThan(0);
      await actAs(c, users.organizer, { aal: 'aal2' });
      expect(await one(c, `select public.can('research', 'view')`)).toBe(true);

      await onPlan(c, ['inventory']);
      for (const who of [users.admin, users.organizer]) {
        await actAs(c, who, { aal: 'aal2' });
        expect(await one(c, `select public.can('research', 'view')`)).toBe(false);
        expect(await one(c, `select public.module_on('statistics')`)).toBe(false);
        for (const t of tables) expect(await count(c, t), t).toBe(0);
        await refused(c, `select public.save_study(null, 'Zz refused', null, null, null, null, null, null, null, '{}')`, [], /permission/);
      }
    });
  });

  it('other areas are untouched', async () => {
    await withTx(async (c) => {
      await onPlan(c, ['inventory']);
      await actAs(c, users.admin, { aal: 'aal2' });
      for (const area of ['patients', 'checklists', 'inventory', 'courses', 'delegates', 'schedule']) {
        expect(await one(c, `select public.can($1, 'edit')`, [area]), area).toBe(true);
      }
    });
  });

  it('switching back restores identical rows', async () => {
    await withTx(async (c) => {
      await seedResearch(c);
      const fingerprint = async () => {
        await actAs(c, users.admin, { aal: 'aal2' });
        return one(c, `select md5(string_agg(t::text, ',' order by id)) from public.studies t`);
      };
      const before = await fingerprint();
      expect(before).not.toBeNull();
      await onPlan(c, ['inventory']);
      expect(await fingerprint()).toBeNull();
      await backToFull(c);
      expect(await fingerprint()).toBe(before);
    });
  });

  it('a plan without inventory switches it off', async () => {
    await withTx(async (c) => {
      await onPlan(c, []);
      await actAs(c, users.admin, { aal: 'aal2' });
      expect(await one(c, `select public.module_on('inventory')`)).toBe(false);
      expect(await one(c, `select public.module_on('statistics')`)).toBe(false);
      expect(await one(c, `select public.module_on('teaching')`)).toBe(true);
      expect(await one(c, `select public.can('inventory', 'edit')`)).toBe(false);
    });
  });

  it('extra modules add to the plan', async () => {
    await withTx(async (c) => {
      await onPlan(c, ['inventory']);
      await c.query(`update public.companies set extra_modules = '{statistics}' where id = $1`, [ACADEMY]);
      await actAs(c, users.admin, { aal: 'aal2' });
      expect((await c.query('select features from public.my_company_plan()')).rows[0].features)
        .toEqual(['inventory', 'statistics', 'teaching']);
      expect(await one(c, `select public.can('research', 'view')`)).toBe(true);
    });
  });

  it('refuses unknown modules and kinds', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      await refused(c, `insert into public.plans (name, kind, modules) values ('Zz bad', 'course_organizer', '{teaching}')`, [], /check/);
      await refused(c, `insert into public.plans (name, kind) values ('Zz bad', 'hospital')`, [], /check/);
      await refused(c, `update public.companies set extra_modules = '{patients}' where id = $1`, [ACADEMY], /check/);
      await refused(c, `update public.companies set kind = 'hospital' where id = $1`, [ACADEMY], /check/);
    });
  });

  it("company users can't read plans or other companies' features", async () => {
    await withTx(async (c) => {
      const other = await provision(c, 'zz-modules-b', 'Zz Modules B');
      await actAs(c, users.admin, { aal: 'aal2' });
      await refused(c, 'select count(*) from public.plans', [], /permission denied/);
      await refused(c, 'select app_private.company_features($1)', [other], /permission denied for schema app_private/);
    });
  });
});

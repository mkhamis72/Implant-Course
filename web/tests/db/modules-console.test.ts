import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asPostgres } from './helpers';

const users = inject('testUsers');
const ACADEMY = 'a7c0de00-0000-4000-8000-000000000001';

async function refused(c: Client, sql: string, params: unknown[], pattern: RegExp) {
  await c.query('savepoint s');
  await expect(c.query(sql, params)).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

async function asServiceRole(c: Client) {
  await asPostgres(c);
  await c.query('set local role service_role');
}

const SAVE = 'select public.console_save_plan($1, $2, $3, $4, $5) as id';
const SET = 'select public.console_set_company_plan($1, $2, $3, $4, $5)';

async function savePlan(c: Client, id: string | null, name: string, modules: string[]): Promise<string> {
  await asServiceRole(c);
  const { rows } = await c.query(SAVE, [id, name, 'course_organizer', modules, 'owner@x']);
  return rows[0].id;
}

const one = async (c: Client, sql: string, params: unknown[] = []) => Object.values((await c.query(sql, params)).rows[0])[0];

describe('modules console (0110)', () => {
  it('saves a plan and refuses bad input', async () => {
    await withTx(async (c) => {
      const id = await savePlan(c, null, 'Zz Basic', []);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      const { rows } = await c.query('select name, kind, modules, updated_by, updated_at from public.plans where id = $1', [id]);
      expect(rows[0]).toMatchObject({ name: 'Zz Basic', kind: 'course_organizer', modules: ['inventory'], updated_by: 'owner@x' });
      expect(rows[0].updated_at).toBeInstanceOf(Date);

      await refused(c, SAVE, [null, 'Zz Basic', 'course_organizer', [], 'owner@x'], /A plan called Zz Basic already exists\./);
      await refused(c, SAVE, [null, 'Zz Clinic', 'clinic', [], 'owner@x'], /Clinic plans come in a later release\./);
      await refused(c, SAVE, [null, 'Zz Teach', 'course_organizer', ['teaching'], 'owner@x'], /Unknown module teaching/);
      await refused(c, SAVE, [null, 'Z', 'course_organizer', [], 'owner@x'], /Give a name \(2–60 characters\)\./);
      await refused(c, SAVE, [id, 'Zz Basic', 'clinic', [], 'owner@x'], /A plan can't change its type\./);
      await refused(c, SAVE, [crypto.randomUUID(), 'Zz Ghost', 'course_organizer', [], 'owner@x'], /Unknown plan/);

      // Saving under its own name is not a duplicate; the update records who and when.
      await asPostgres(c);
      await c.query(`update public.plans set updated_by = null, updated_at = now() - interval '1 day' where id = $1`, [id]);
      expect(await savePlan(c, id, 'Zz Basic', ['statistics'])).toBe(id);
      const after = (await c.query('select modules, updated_by, updated_at > now() - interval \'1 minute\' as fresh from public.plans where id = $1', [id])).rows[0];
      expect(after).toEqual({ modules: ['inventory', 'statistics'], updated_by: 'owner@x', fresh: true });

      await actAs(c, users.admin, { aal: 'aal2' });
      await refused(c, SAVE, [null, 'Zz Other', 'course_organizer', [], 'x'], /permission denied for function console_save_plan/);
    });
  });

  it('plan edit reaches its companies', async () => {
    await withTx(async (c) => {
      const plan = await savePlan(c, null, 'Zz Basic', []);
      await asPostgres(c);
      await c.query('update public.companies set plan_id = $1 where id = $2', [plan, ACADEMY]);
      await actAs(c, users.admin, { aal: 'aal2' });
      expect(await one(c, `select public.module_on('statistics')`)).toBe(false);

      await savePlan(c, plan, 'Zz Basic', ['statistics']);
      await actAs(c, users.admin, { aal: 'aal2' });
      expect(await one(c, `select public.module_on('statistics')`)).toBe(true);
    });
  });

  it("sets a company's plan, refusing mismatches", async () => {
    await withTx(async (c) => {
      const plan = await savePlan(c, null, 'Zz Basic', []);
      await asServiceRole(c);
      await c.query(SET, ['academy', 'course_organizer', plan, ['statistics'], 'owner@x']);
      await refused(c, SET, ['academy', 'clinic', plan, [], 'owner@x'], /Clinic companies come in a later release\./);
      await refused(c, SET, ['academy', 'course_organizer', plan, ['teaching'], 'owner@x'], /Unknown module teaching/);
      await refused(c, SET, ['zz-nowhere', 'course_organizer', plan, [], 'owner@x'], /Unknown company zz-nowhere/);
      await asPostgres(c);
      const clinicPlan = (await c.query(`insert into public.plans (name, kind) values ('Zz Clinic plan', 'clinic') returning id`)).rows[0].id;
      await asServiceRole(c);
      await refused(c, SET, ['academy', 'course_organizer', clinicPlan, [], 'owner@x'], /Choose a plan for this type of company\./);

      await actAs(c, users.admin, { aal: 'aal2' });
      const { rows } = await c.query('select * from public.my_company_plan()');
      expect(rows[0].plan_name).toBe('Zz Basic');
      expect(rows[0].features).toContain('statistics');
      await refused(c, SET, ['academy', 'course_organizer', plan, [], 'x'], /permission denied for function console_set_company_plan/);
    });
  });

  it('history records plan changes', async () => {
    await withTx(async (c) => {
      const plan = await savePlan(c, null, 'Zz Basic', []);
      await asServiceRole(c);
      await c.query(SET, ['academy', 'course_organizer', plan, [], 'owner@x']);
      const { rows } = await c.query(
        `select actor, before, after from public.company_log where slug = 'academy' order by id desc limit 1`);
      expect(rows[0].actor).toBe('owner@x');
      expect(rows[0].after.plan_id).toBe(plan);
      expect(rows[0].before.plan_id).toBe('fa110000-0000-4000-8000-000000000001');
      expect(rows[0].after).toMatchObject({ kind: 'course_organizer', extra_modules: [] });
    });
  });

  it('a clinic loses courses and delegates, keeps patients', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      await c.query(`update public.companies set kind = 'clinic' where id = $1`, [ACADEMY]);
      await actAs(c, users.admin, { aal: 'aal2' });
      expect(await one(c, `select public.can('courses', 'edit')`)).toBe(false);
      expect(await one(c, `select public.can('delegates', 'edit')`)).toBe(false);
      expect(await one(c, `select public.can('patients', 'edit')`)).toBe(true);
    });
  });
});

import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asPostgres } from './helpers';
import { makePatient, makeProduct, receive, place } from './fixtures';

const users = inject('testUsers');
const ACADEMY = 'a7c0de00-0000-4000-8000-000000000001';
const FULL_PLAN = 'fa110000-0000-4000-8000-000000000001';

const one = async (c: Client, sql: string, params: unknown[] = []) => Object.values((await c.query(sql, params)).rows[0])[0];
const count = async (c: Client, table: string) => Number(await one(c, `select count(*)::int from public.${table}`));

/** Puts academy on a plan with only Statistics (as postgres, rolled back with the test). */
async function inventoryOff(c: Client) {
  await asPostgres(c);
  const { rows } = await c.query(
    `insert into public.plans (name, kind, modules) values ('Zz no inventory', 'course_organizer', '{statistics}') returning id`);
  await c.query('update public.companies set plan_id = $1 where id = $2', [rows[0].id, ACADEMY]);
}

async function backToFull(c: Client) {
  await asPostgres(c);
  await c.query('update public.companies set plan_id = $1 where id = $2', [FULL_PLAN, ACADEMY]);
}

/** One received lot in academy, as the admin on Full. */
async function seedLot(c: Client): Promise<{ product: string; lot: string }> {
  await actAs(c, users.admin, { aal: 'aal2' });
  const product = await makeProduct(c, 'implant', 'Zz Inv Brand');
  const lot = await receive(c, product, 3, 'ZZINVLOT');
  return { product, lot };
}

describe('modules: inventory optional (0111)', () => {
  it('inventory off closes stock', async () => {
    await withTx(async (c) => {
      const { product, lot } = await seedLot(c);
      expect(await one(c, 'select count(*)::int from public.stock_lots where id = $1', [lot])).toBe(1);
      expect(await one(c, 'select count(*)::int from public.stock_movements where stock_lot_id = $1', [lot])).toBe(1);
      expect(await one(c, 'select on_hand from public.stock_on_hand where stock_lot_id = $1', [lot])).toBe(3);

      await inventoryOff(c);
      await actAs(c, users.admin, { aal: 'aal2' });
      for (const t of ['stock_lots', 'stock_movements', 'stock_on_hand']) expect(await count(c, t), t).toBe(0);
      expect(await one(c, `select count(*)::int from public.pull_list(public.cairo_today()) where available > 0`)).toBe(0);
      // The catalogue stays readable (placements pick from it); no product shows stock.
      const { rows } = await c.query(
        `select count(*) filter (where on_hand > 0 or nearest_expiry is not null)::int as stocked,
                count(*) filter (where id = $1)::int as seeded
         from public.inventory_overview('', '', true)`, [product]);
      expect(rows[0]).toEqual({ stocked: 0, seeded: 1 });
      expect(await one(c, `select public.can('inventory', 'view')`)).toBe(false);
    });
  });

  it('my_report hides lots when inventory is off', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const me = (await c.query(
        'select delegate_id from public.company_members where company_id = $1 and user_id = $2', [ACADEMY, users.delegate])).rows[0].delegate_id;
      const { product, lot } = await seedLot(c);
      const patient = await makePatient(c, 'Zz Inv Report Patient');
      const site = await place(c, { patient, tooth: 36, product, lot, delegate: me, supervisor: users.organizer });

      const lotOf = async () => {
        await actAs(c, users.delegate);
        return (await c.query('select lot_no from public.my_report() where site_id = $1', [site])).rows;
      };
      expect(await lotOf()).toEqual([{ lot_no: 'ZZINVLOT' }]);
      await inventoryOff(c);
      expect(await lotOf()).toEqual([{ lot_no: null }]);
    });
  });

  it('switching back restores identical stock', async () => {
    await withTx(async (c) => {
      await seedLot(c);
      const fingerprint = async () => {
        await actAs(c, users.admin, { aal: 'aal2' });
        return one(c, `select md5(string_agg(t::text, ',' order by id)) from public.stock_movements t`);
      };
      const before = await fingerprint();
      expect(before).not.toBeNull();
      await inventoryOff(c);
      expect(await fingerprint()).toBeNull();
      await backToFull(c);
      expect(await fingerprint()).toBe(before);
    });
  });

  it('a plan without inventory is saved as is', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      await c.query('set local role service_role');
      const id = await one(c, `select public.console_save_plan(null, 'Zz NoInv', 'course_organizer', '{statistics}', 'x')`);
      await asPostgres(c);
      expect(await one(c, 'select modules from public.plans where id = $1', [id])).toEqual(['statistics']);
    });
  });
});

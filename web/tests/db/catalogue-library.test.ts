import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asPostgres } from './helpers';

const ACADEMY_ID = 'a7c0de00-0000-4000-8000-000000000001';
const users = inject('testUsers');
const CSV_ROWS = readFileSync(join(process.cwd(), '..', 'docs', 'catalog', 'oxy-catalog.csv'), 'utf8')
  .split(/\r?\n/).filter((l) => l.trim() !== '').length - 1;

async function one<T = Record<string, unknown>>(c: Client, sql: string, params: unknown[] = []): Promise<T> {
  return (await c.query(sql, params)).rows[0] as T;
}

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

/** One of academy's Oxy implants that the migration linked to the library. */
async function linkedProduct(c: Client): Promise<{ id: string; catalog_item_id: string }> {
  await asPostgres(c);
  return one(c, `select id, catalog_item_id from public.products
    where company_id = $1 and brand = 'Oxy Implant' and type = 'implant' and catalog_item_id is not null
    order by ref_code limit 1`, [ACADEMY_ID]);
}

describe('catalogue library (0128)', () => {
  it('seeds the library from the Oxy CSV', async () => {
    await withTx(async (c) => {
      const { n } = await one<{ n: number }>(c,
        `select count(*)::int as n from public.catalog_items where brand = 'Oxy Implant' and not retired`);
      expect(n).toBe(CSV_ROWS);
    });
  });

  it("links academy's Oxy products and leaves them active", async () => {
    await withTx(async (c) => {
      const { unlinked } = await one<{ unlinked: number }>(c, `select count(*)::int as unlinked from public.products
        where company_id = $1 and brand = 'Oxy Implant' and not is_sample and catalog_item_id is null`, [ACADEMY_ID]);
      expect(unlinked).toBe(0);
      const { n } = await one<{ n: number }>(c, `select count(*)::int as n from public.products
        where company_id = $1 and catalog_item_id is not null and active`, [ACADEMY_ID]);
      expect(n).toBe(CSV_ROWS);
    });
  });

  it("refuses changing a linked product's catalogue fields", async () => {
    await withTx(async (c) => {
      const p = await linkedProduct(c);
      await actAs(c, users.organizer);
      await refused(c, () => c.query(`update public.products set ref_code = 'X' where id = $1`, [p.id]),
        /comes from the catalogue library, so only its reorder level and Active can change/);
      await refused(c, () => c.query(`update public.products set description = 'changed' where id = $1`, [p.id]),
        /comes from the catalogue library/);
      await c.query('update public.products set reorder_level = 5 where id = $1', [p.id]);
      await c.query('update public.products set active = false where id = $1', [p.id]);
      expect(await one(c, 'select reorder_level, active from public.products where id = $1', [p.id]))
        .toEqual({ reorder_level: 5, active: false });
    });
  });

  it('catalog items are readable and not writable by users', async () => {
    await withTx(async (c) => {
      const p = await linkedProduct(c);
      await actAs(c, users.organizer);
      expect((await c.query('select id from public.catalog_items where id = $1', [p.catalog_item_id])).rows).toHaveLength(1);
      await refused(c, () => c.query(`update public.catalog_items set description = 'x' where id = $1`, [p.catalog_item_id]),
        /permission denied/);
      await refused(c, () => c.query('delete from public.catalog_items where id = $1', [p.catalog_item_id]), /permission denied/);
      await refused(c, () => c.query(`insert into public.catalog_items (type, brand) values ('implant', 'X')`), /permission denied/);
      await refused(c, () => c.query('update public.products set catalog_item_id = null where id = $1', [p.id]),
        /permission denied/);
    });
  });
});

const COMPANY_B = "(select id from public.companies where slug = 'company-b')";

/** A library item only this test knows about (rolled back with the test). */
async function newItem(c: Client, ref: string, retired = false): Promise<string> {
  await asPostgres(c);
  return (await one<{ id: string }>(c, `insert into public.catalog_items (type, brand, system, platform, diameter_mm, length_mm, ref_code, retired)
    values ('implant', 'Zz Library', 'Zz System', 'Zz', 4, 10, $1, $2) returning id`, [ref, retired])).id;
}

async function asAdmin(c: Client) {
  await actAs(c, users.admin);
}

describe('set_catalog_items / set_products_active (0128)', () => {
  it('switches an item on by creating a linked product', async () => {
    await withTx(async (c) => {
      const item = await newItem(c, 'ZZ1');
      await asAdmin(c);
      expect((await one<{ n: number }>(c, 'select public.set_catalog_items($1, true) as n', [[item]])).n).toBe(1);
      await asPostgres(c);
      expect(await one(c, `select company_id, active, brand, ref_code, reorder_level from public.products where catalog_item_id = $1`, [item]))
        .toEqual({ company_id: ACADEMY_ID, active: true, brand: 'Zz Library', ref_code: 'ZZ1', reorder_level: 0 });
    });
  });

  it('switching on again changes nothing', async () => {
    await withTx(async (c) => {
      const p = await linkedProduct(c);
      await asAdmin(c);
      expect((await one<{ n: number }>(c, 'select public.set_catalog_items($1, true) as n', [[p.catalog_item_id]])).n).toBe(0);
    });
  });

  it('reuses an unlinked row with the same brand, type and ref code', async () => {
    await withTx(async (c) => {
      const item = await newItem(c, 'ZZ2');
      const own = (await one<{ id: string }>(c, `insert into public.products (company_id, type, brand, system, ref_code, description, active)
        values ($1, 'implant', 'Zz Library', 'Older name', 'ZZ2', 'edited', false) returning id`, [ACADEMY_ID])).id;
      await asAdmin(c);
      expect((await one<{ n: number }>(c, 'select public.set_catalog_items($1, true) as n', [[item]])).n).toBe(1);
      await asPostgres(c);
      expect((await c.query('select id, active from public.products where catalog_item_id = $1', [item])).rows)
        .toEqual([{ id: own, active: true }]);
    });
  });

  it('switches off without deleting', async () => {
    await withTx(async (c) => {
      const p = await linkedProduct(c);
      await asAdmin(c);
      expect((await one<{ n: number }>(c, 'select public.set_catalog_items($1, false) as n', [[p.catalog_item_id]])).n).toBe(1);
      await asPostgres(c);
      expect(await one(c, 'select active from public.products where id = $1', [p.id])).toEqual({ active: false });
    });
  });

  it('refuses a retired item', async () => {
    await withTx(async (c) => {
      const item = await newItem(c, 'ZZ3', true);
      await asAdmin(c);
      await refused(c, () => c.query('select public.set_catalog_items($1, true)', [[item]]),
        /This product is no longer in the catalogue\./);
    });
  });

  it('refuses an unknown item', async () => {
    await withTx(async (c) => {
      await asAdmin(c);
      await refused(c, () => c.query('select public.set_catalog_items($1, true)', [['00000000-0000-4000-8000-000000000000']]),
        /Product not found\./);
    });
  });

  it('refuses a non-admin', async () => {
    await withTx(async (c) => {
      const p = await linkedProduct(c);
      await actAs(c, users.organizer);
      await refused(c, () => c.query('select public.set_catalog_items($1, false)', [[p.catalog_item_id]]), /Only an admin can do this\./);
      await refused(c, () => c.query('select public.set_products_active($1, false)', [[p.id]]), /Only an admin can do this\./);
    });
  });

  it('leaves other companies alone', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const before = await one(c, `select count(*) filter (where active)::int as on, count(*)::int as n from public.products where company_id = ${COMPANY_B}`);
      const all = (await c.query(`select array_agg(id) as ids from public.catalog_items where not retired`)).rows[0].ids;
      const bIds = (await c.query(`select array_agg(id) as ids from public.products where company_id = ${COMPANY_B}`)).rows[0].ids;
      await asAdmin(c);
      await c.query('select public.set_catalog_items($1, false)', [all]);
      expect((await one<{ n: number }>(c, 'select public.set_products_active($1, false) as n', [bIds])).n).toBe(0);
      await asPostgres(c);
      expect(await one(c, `select count(*) filter (where active)::int as on, count(*)::int as n from public.products where company_id = ${COMPANY_B}`))
        .toEqual(before);
    });
  });

  it('set_products_active switches own rows', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const own = (await one<{ id: string }>(c, `insert into public.products (company_id, type, brand, active)
        values ($1, 'other', 'Zz Own', true) returning id`, [ACADEMY_ID])).id;
      await asAdmin(c);
      expect((await one<{ n: number }>(c, 'select public.set_products_active($1, false) as n', [[own]])).n).toBe(1);
      expect((await one<{ n: number }>(c, 'select public.set_products_active($1, false) as n', [[own]])).n).toBe(0);
      expect((await one<{ n: number }>(c, 'select public.set_products_active($1, true) as n', [[own]])).n).toBe(1);
    });
  });
});

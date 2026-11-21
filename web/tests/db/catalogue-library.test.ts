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

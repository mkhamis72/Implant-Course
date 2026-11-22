import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asPostgres } from './helpers';
import { makeProduct } from './fixtures';

const ACADEMY_ID = 'a7c0de00-0000-4000-8000-000000000001';
const users = inject('testUsers');

const SPECS = `connection, gingival_height_mm, angle_deg, material, driver_interface, driver_size, driver_ref, torque_ncm`;
const SPEC_VALUES = {
  connection: 'Internal hex', gingival_height_mm: '3.0', angle_deg: '17.0', material: 'Titanium',
  driver_interface: 'Hex', driver_size: '1.25 mm', driver_ref: 'DRV-125', torque_ncm: '25.0',
};
const SET_SPECS = `connection = 'Internal hex', gingival_height_mm = 3, angle_deg = 17, material = 'Titanium',
  driver_interface = 'Hex', driver_size = '1.25 mm', driver_ref = 'DRV-125', torque_ncm = 25`;

async function one<T = Record<string, unknown>>(c: Client, sql: string, params: unknown[] = []): Promise<T> {
  return (await c.query(sql, params)).rows[0] as T;
}

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

async function linkedProduct(c: Client): Promise<{ id: string; catalog_item_id: string }> {
  await asPostgres(c);
  return one(c, `select id, catalog_item_id from public.products
    where company_id = $1 and brand = 'Oxy Implant' and type = 'implant' and catalog_item_id is not null
    order by ref_code limit 1`, [ACADEMY_ID]);
}

describe('component tracking (0133–0135)', () => {
  it('has the new component and product types', async () => {
    await withTx(async (c) => {
      const comp = await c.query(`select unnest(enum_range(null::public.component_type))::text as v`);
      const prod = await c.query(`select unnest(enum_range(null::public.product_type))::text as v`);
      const compVals = comp.rows.map((r) => r.v);
      const prodVals = prod.rows.map((r) => r.v);
      expect(compVals).toEqual(
        expect.arrayContaining([
          'healing_cap', 'temporary_abutment', 'scan_body', 'impression_coping',
          'abutment_screw', 'prosthetic_screw', 'temporary_cylinder_screw',
        ]),
      );
      expect(prodVals).toEqual(expect.arrayContaining(['healing_cap', 'temporary_abutment', 'abutment_screw']));
    });
  });

  it('stores specs on a hand-entered product', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await makeProduct(c, 'abutment_angled', 'Zz Specs Brand');
      await c.query(`update public.products set ${SET_SPECS} where id = $1`, [id]);
      expect(await one(c, `select ${SPECS} from public.products where id = $1`, [id])).toEqual(SPEC_VALUES);
    });
  });

  it('refuses spec changes on a library-linked product', async () => {
    await withTx(async (c) => {
      const p = await linkedProduct(c);
      await actAs(c, users.organizer);
      await refused(c, () => c.query(`update public.products set driver_size = 'x' where id = $1`, [p.id]),
        /This product comes from the catalogue library, so only its reorder level and Active can change\./);
      await refused(c, () => c.query(`update public.products set torque_ncm = 30 where id = $1`, [p.id]),
        /comes from the catalogue library/);
    });
  });

  it('copies library specs when an item is switched on', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const item = (await one<{ id: string }>(c, `insert into public.catalog_items (type, brand, system, ref_code)
        values ('abutment_angled', 'Zz Spec Library', 'Zz System', 'ZZS1') returning id`)).id;
      const copyItem = (await one<{ id: string }>(c, `insert into public.catalog_items (type, brand, system, ref_code)
        values ('abutment_angled', 'Zz Spec Library', 'Zz System', 'ZZS2') returning id`)).id;
      await c.query(`update public.catalog_items set ${SET_SPECS} where id = any($1)`, [[item, copyItem]]);
      await actAs(c, users.admin);
      // A hand-entered copy of the second item gets linked rather than a new product made.
      const copy = (await one<{ id: string }>(c, `insert into public.products (type, brand, system, ref_code)
        values ('abutment_angled', 'Zz Spec Library', 'Zz System', 'ZZS2') returning id`)).id;
      await c.query('select * from public.save_catalogue($1, $2, $3, $4)', [[item, copyItem], [], [], []]);
      expect(await one(c, `select ${SPECS} from public.products where catalog_item_id = $1`, [item])).toEqual(SPEC_VALUES);
      expect(await one(c, `select catalog_item_id, ${SPECS} from public.products where id = $1`, [copy]))
        .toEqual({ catalog_item_id: copyItem, ...SPEC_VALUES });
    });
  });

  it('a library update reaches linked products', async () => {
    await withTx(async (c) => {
      const p = await linkedProduct(c);
      await c.query('update public.catalog_items set torque_ncm = 35 where id = $1', [p.catalog_item_id]);
      await actAs(c, users.organizer);
      expect(await one(c, 'select torque_ncm from public.products where id = $1', [p.id])).toEqual({ torque_ncm: '35.0' });
    });
  });

  it('refuses an angle of 60', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await makeProduct(c, 'abutment_angled', 'Zz Specs Brand');
      await refused(c, () => c.query('update public.products set angle_deg = 60 where id = $1', [id]), /check constraint/);
      await asPostgres(c);
      const p = await linkedProduct(c);
      await refused(c, () => c.query('update public.catalog_items set angle_deg = 60 where id = $1', [p.catalog_item_id]),
        /check constraint/);
    });
  });
});

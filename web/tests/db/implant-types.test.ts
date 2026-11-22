import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asPostgres } from './helpers';
import { book, enroll, makeChair, makeCourse, makeDelegate, makePatient, makeProduct, makeSession, place, receive } from './fixtures';

const ACADEMY_ID = 'a7c0de00-0000-4000-8000-000000000001';
const users = inject('testUsers');

async function one<T = Record<string, unknown>>(c: Client, sql: string, params: unknown[] = []): Promise<T> {
  return (await c.query(sql, params)).rows[0] as T;
}

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

/** The migration's backfill, between its `-- backfill:start` and `-- backfill:end` markers. */
function backfillSql(): string {
  const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', '0139_implant_kind_and_geometry.sql'), 'utf8');
  const m = /-- backfill:start([\s\S]*?)-- backfill:end/.exec(sql);
  if (!m) throw new Error('0139 has no backfill markers');
  return m[1];
}

/** One of academy's Oxy implants that 0128 linked to the library. */
async function linkedProduct(c: Client): Promise<{ id: string; catalog_item_id: string }> {
  await asPostgres(c);
  return one(c, `select id, catalog_item_id from public.products
    where company_id = $1 and brand = 'Oxy Implant' and type = 'implant' and catalog_item_id is not null
    order by ref_code limit 1`, [ACADEMY_ID]);
}

/** A booking with a planned implant of `planned` on tooth 16, then placed with `placed`. */
async function placedFromBooking(c: Client) {
  await actAs(c, users.admin);
  const chair = await makeChair(c);
  await actAs(c, users.organizer);
  const course = await makeCourse(c, '2030-03-01', '2030-03-05');
  const session = await makeSession(c, course, 'surgery', '2030-03-02');
  const delegate = await makeDelegate(c, 'Zz Types Placer');
  await enroll(c, course, delegate);
  const planned = await makeProduct(c, 'implant', 'Zz Types Planned');
  const placed = await makeProduct(c, 'implant', 'Zz Types Placed');
  const lot = await receive(c, placed, 5, 'ZZTYPES');
  const patient = await makePatient(c, 'Zz Types Patient');
  const slot = await book(c, {
    session, chair, patient, supervisor: users.organizer, placing: [delegate],
    implants: [{ tooth: 16, product_id: planned }],
  });
  const site = await place(c, {
    patient, tooth: 16, product: placed, lot, delegate, supervisor: users.organizer, slot, placedOn: '2026-01-10',
  });
  return { site, planned, placed };
}

describe('implant types (0139–0140)', () => {
  it('a 45 mm zygomatic implant product can be saved', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const { id } = await one<{ id: string }>(c, `insert into public.products
        (type, brand, system, diameter_mm, length_mm, implant_kind)
        values ('implant', 'Zz Zygoma', 'Z', 4.0, 45, 'zygomatic') returning id`);
      const row = await one<{ length_mm: string; implant_kind: string }>(c,
        'select length_mm, implant_kind from public.products where id = $1', [id]);
      expect(Number(row.length_mm)).toBe(45);
      expect(row.implant_kind).toBe('zygomatic');
      await c.query(`update public.products set length_mm = 60, implant_kind = 'pterygoid' where id = $1`, [id]);
      await refused(c, () => c.query(`update public.products set implant_kind = 'tilted' where id = $1`, [id]),
        /check constraint/);
    });
  });

  it('61 mm is refused', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await refused(c, () => c.query(`insert into public.products (type, brand, system, diameter_mm, length_mm)
        values ('implant', 'Zz Too Long', 'Z', 4.0, 61)`), /check constraint/);
      await asPostgres(c);
      await c.query(`insert into public.catalog_items (type, brand, system, diameter_mm, length_mm, ref_code, implant_kind)
        values ('implant', 'Zz Library Zyg', 'Z', 4.0, 60, 'ZZ-60', 'zygomatic')`);
      await refused(c, () => c.query(`insert into public.catalog_items (type, brand, system, diameter_mm, length_mm, ref_code)
        values ('implant', 'Zz Library Zyg', 'Z', 4.0, 61, 'ZZ-61')`), /check constraint/);
    });
  });

  it('implant_kind defaults to conventional', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await makeProduct(c, 'implant', 'Zz Default Kind');
      const row = await one<{ implant_kind: string }>(c, 'select implant_kind from public.products where id = $1', [id]);
      expect(row.implant_kind).toBe('conventional');
      await asPostgres(c);
      const { n } = await one<{ n: number }>(c,
        `select count(*)::int as n from public.catalog_items where implant_kind <> 'conventional'`);
      expect(n).toBe(0);
    });
  });

  it('a linked product refuses an implant_kind change', async () => {
    await withTx(async (c) => {
      const p = await linkedProduct(c);
      await actAs(c, users.organizer);
      await refused(c, () => c.query(`update public.products set implant_kind = 'zygomatic' where id = $1`, [p.id]),
        /comes from the catalogue library, so only its reorder level and Active can change/);
    });
  });

  it('a library implant_kind change reaches linked products', async () => {
    await withTx(async (c) => {
      const p = await linkedProduct(c);
      await c.query(`update public.catalog_items set implant_kind = 'pterygoid' where id = $1`, [p.catalog_item_id]);
      const row = await one<{ implant_kind: string }>(c, 'select implant_kind from public.products where id = $1', [p.id]);
      expect(row.implant_kind).toBe('pterygoid');
    });
  });

  it('switching on a library item copies its implant_kind', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const { id } = await one<{ id: string }>(c, `insert into public.catalog_items
        (type, brand, system, diameter_mm, length_mm, ref_code, implant_kind)
        values ('implant', 'Zz Library Kind', 'Z', 4.0, 45, 'ZZ-KIND', 'zygomatic') returning id`);
      await actAs(c, users.admin);
      await c.query('select public.set_catalog_items($1::uuid[], true)', [[id]]);
      const row = await one<{ implant_kind: string }>(c,
        'select implant_kind from public.products where catalog_item_id = $1', [id]);
      expect(row.implant_kind).toBe('zygomatic');
    });
  });

  it('placed implants are backfilled as conventional', async () => {
    await withTx(async (c) => {
      const { site } = await placedFromBooking(c);
      await asPostgres(c);
      const planned = await one<{ id: string }>(c,
        `select id from public.implant_sites where state = 'planned' and implant_type is null limit 1`);
      await c.query('update public.implant_sites set implant_type = null, planned_product_id = null where id = $1', [site]);
      await c.query(backfillSql());
      const row = await one<{ implant_type: string | null }>(c,
        'select implant_type from public.implant_sites where id = $1', [site]);
      expect(row.implant_type).toBe('conventional');
      if (planned) {
        const p = await one<{ implant_type: string | null }>(c,
          'select implant_type from public.implant_sites where id = $1', [planned.id]);
        expect(p.implant_type).toBeNull();
      }
      const { n } = await one<{ n: number }>(c, `select count(*)::int as n from public.implant_sites
        where state in ('placed', 'restored', 'failed') and implant_type is null`);
      expect(n).toBe(0);
    });
  });

  it('backfill takes the planned product from the booking', async () => {
    await withTx(async (c) => {
      const { site, planned, placed } = await placedFromBooking(c);
      await asPostgres(c);
      await c.query('update public.implant_sites set implant_type = null, planned_product_id = null where id = $1', [site]);
      const { audits } = await one<{ audits: number }>(c, 'select count(*)::int as audits from public.audit_log');
      await c.query(backfillSql());
      const row = await one<{ planned_product_id: string | null; product_id: string }>(c,
        'select planned_product_id, product_id from public.implant_sites where id = $1', [site]);
      expect(row.product_id).toBe(placed);
      expect(row.planned_product_id).toBe(planned);
      const after = await one<{ audits: number }>(c, 'select count(*)::int as audits from public.audit_log');
      expect(after.audits).toBe(audits); // written without audit rows
    });
  });
});

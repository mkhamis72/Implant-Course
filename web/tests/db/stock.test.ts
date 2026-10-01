import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { makeProduct, onHand, receive } from './fixtures';

const users = inject('testUsers');

async function refused(c: Client, sql: string, params: unknown[], pattern: RegExp) {
  await c.query('savepoint s');
  await expect(c.query(sql, params)).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

describe('receiving stock', () => {
  it('creates a batch and a receive movement; lot and expiry are optional', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const product = await makeProduct(c);
      const withLot = await receive(c, product, 5, 'A123', '2030-01-31');
      const noLot = await receive(c, product, 2, null, null);
      expect(await onHand(c, withLot)).toBe(5);
      expect(await onHand(c, noLot)).toBe(2);
      const { rows } = await c.query(
        'select reason, delta, created_by from public.stock_movements where stock_lot_id = $1',
        [withLot],
      );
      expect(rows).toEqual([{ reason: 'receive', delta: 5, created_by: users.organizer }]);
    });
  });

  it('refuses bad quantities and inactive products with user-facing messages', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const product = await makeProduct(c);
      await refused(c, 'select public.receive_stock($1, 0)', [product], /Enter a quantity between 1 and 100000/);
      await c.query('update public.products set active = false where id = $1', [product]);
      await refused(c, 'select public.receive_stock($1, 1)', [product], /Choose an active product/);
    });
  });

  it('inactive users cannot receive stock', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const product = await makeProduct(c);
      await actAs(c, users.inactive);
      await expect(c.query('select public.receive_stock($1, 1)', [product])).rejects.toThrow(/Not allowed/);
    });
  });
});

describe('adjusting stock', () => {
  it('waste takes stock out, adjustments go either way, a reason is required', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const lot = await receive(c, await makeProduct(c), 3);
      await c.query("select public.adjust_stock($1, -1, 'waste', 'Dropped on floor')", [lot]);
      await c.query("select public.adjust_stock($1, 2, 'adjust', 'Stock count correction')", [lot]);
      expect(await onHand(c, lot)).toBe(4);
      await refused(c, "select public.adjust_stock($1, 1, 'waste', 'oops')", [lot], /Waste and returns take stock out/);
      await refused(c, "select public.adjust_stock($1, -1, 'adjust', ' ')", [lot], /Explain the change/);
      await refused(c, "select public.adjust_stock($1, 1, 'receive', 'x x x')", [lot], /Choose adjust, waste or return/);
    });
  });

  it('stock never goes negative', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const lot = await receive(c, await makeProduct(c), 2);
      await refused(c, "select public.adjust_stock($1, -3, 'return', 'Back to supplier')", [lot], /Only 2 left in this batch/);
    });
  });
});

describe('the ledger', () => {
  it('direct writes to batches and movements are refused', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const product = await makeProduct(c);
      const lot = await receive(c, product, 1);
      await refused(c, "insert into public.stock_lots (product_id, qty_received) values ($1, 5)", [product], /permission denied/);
      await refused(c, "insert into public.stock_movements (stock_lot_id, delta, reason) values ($1, 9, 'adjust')", [lot], /permission denied/);
      await refused(c, 'update public.stock_movements set delta = 99 where stock_lot_id = $1', [lot], /permission denied/);
    });
  });

  it('movements are immutable even for the postgres role', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const lot = await receive(c, await makeProduct(c), 1);
      await asPostgres(c);
      await refused(c, 'update public.stock_movements set delta = 99 where stock_lot_id = $1', [lot], /append-only/);
      await refused(c, 'delete from public.stock_movements where stock_lot_id = $1', [lot], /append-only/);
    });
  });
});

describe('overview and lot search', () => {
  it('reports on hand and nearest expiry per product; lists stocked products by default', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const product = await makeProduct(c, 'implant', 'Zz Overview Brand');
      await receive(c, product, 3, 'B1', '2031-05-01');
      await receive(c, product, 2, 'B2', '2030-02-01');
      const { rows } = await c.query("select on_hand, nearest_expiry::text from public.inventory_overview('Zz Overview')");
      expect(rows).toEqual([{ on_hand: 5, nearest_expiry: '2030-02-01' }]);
      const unstocked = await makeProduct(c, 'implant', 'Zz Unstocked Brand');
      expect((await c.query("select id from public.inventory_overview('Zz Unstocked')")).rows).toHaveLength(0);
      const all = await c.query("select id from public.inventory_overview('Zz Unstocked', '', true)");
      expect(all.rows.map((r) => r.id)).toEqual([unstocked]);
    });
  });

  it('finds batches by lot number, case-insensitively and literally', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const product = await makeProduct(c);
      await receive(c, product, 1, 'ZZLOT-9_1');
      await receive(c, product, 1, 'ZZLOT-991');
      const { rows } = await c.query("select lot_no from public.search_lots('zzlot-9_')");
      expect(rows.map((r) => r.lot_no)).toEqual(['ZZLOT-9_1']);
    });
  });
});

import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs } from './helpers';
import { makeProduct } from './fixtures';

const users = inject('testUsers');

describe('product catalog', () => {
  it('ships a sample catalog flagged for verification', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const { rows } = await c.query(
        `select type, count(*)::int as n from public.products where is_sample group by type`,
      );
      const counts = Object.fromEntries(rows.map((r) => [r.type, r.n]));
      expect(counts.implant).toBe(84);
      expect(counts.healing_abutment).toBe(12);
      expect(counts.ti_base).toBe(6);
      expect(counts.graft).toBe(2);
      expect(counts.membrane).toBe(1);
      const straumann = await c.query(
        "select count(*)::int as n from public.products where brand = 'Straumann' and system = 'BLX' and type = 'implant'",
      );
      expect(straumann.rows[0].n).toBe(12);
    });
  });

  it('derives the category from the type', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const implant = await makeProduct(c, 'implant');
      const tibase = await makeProduct(c, 'ti_base');
      const { rows } = await c.query('select id, category from public.products where id in ($1, $2)', [implant, tibase]);
      const byId = Object.fromEntries(rows.map((r) => [r.id, r.category]));
      expect(byId[implant]).toBe('surgical');
      expect(byId[tibase]).toBe('prosthetic');
    });
  });

  it('implants need a diameter and a length', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await expect(
        c.query("insert into public.products (type, brand) values ('implant', 'X')"),
      ).rejects.toThrow(/products_implant_size/);
    });
  });

  it('users cannot delete products, forge the creator or set the category', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const id = await makeProduct(c);
      for (const sql of [
        'delete from public.products where id = $1',
        "update public.products set created_by = null where id = $1",
      ]) {
        await c.query('savepoint s');
        await expect(c.query(sql, [id])).rejects.toThrow(/permission denied/);
        await c.query('rollback to savepoint s');
      }
      await expect(c.query("update public.products set category = 'x' where id = $1", [id])).rejects.toThrow(
        /permission denied|generated column|can only be updated to DEFAULT/,
      );
    });
  });

  it('inactive users see no products', async () => {
    await withTx(async (c) => {
      await actAs(c, users.inactive);
      expect((await c.query('select id from public.products limit 1')).rows).toHaveLength(0);
    });
  });
});

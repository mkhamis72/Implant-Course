import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asPostgres } from './helpers';
import { makeDelegate, makePatient, makeProduct, onHand, receive, place } from './fixtures';

const users = inject('testUsers');
const ACADEMY = 'a7c0de00-0000-4000-8000-000000000001';
const FULL_PLAN = 'fa110000-0000-4000-8000-000000000001';

const one = async (c: Client, sql: string, params: unknown[] = []) => Object.values((await c.query(sql, params)).rows[0])[0];
const count = async (c: Client, table: string) => Number(await one(c, `select count(*)::int from public.${table}`));

/** Puts academy on a plan with only Statistics (as postgres, rolled back with the test). */
async function inventoryOff(c: Client) {
  await asPostgres(c);
  const { rows } = await c.query(
    `insert into public.plans (name, kind, modules) values ('Zz no inventory', 'course_organizer', '{statistics}')
     on conflict (name) do update set modules = excluded.modules returning id`);
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

  describe('implants and components without stock batches (0112)', () => {
    /** A received implant lot, a second implant, a healing abutment, a patient and a delegate, made on Full. */
    async function world(c: Client) {
      const { product, lot } = await seedLot(c);
      const other = await makeProduct(c, 'implant', 'Zz Inv Other');
      const ha = await makeProduct(c, 'healing_abutment', 'Zz Inv HA');
      const patient = await makePatient(c, 'Zz Inv Lots Patient');
      const delegate = await makeDelegate(c, 'Zz Inv Lots Delegate');
      return { product, lot, other, ha, patient, delegate };
    }
    type World = Awaited<ReturnType<typeof world>>;

    const placeAt = (c: Client, w: World, tooth: number, lot: string | null) =>
      place(c, { patient: w.patient, tooth, product: w.product, lot: lot as string, delegate: w.delegate, supervisor: users.organizer });

    const fit = async (c: Client, site: string, product: string | null, lot: string | null) =>
      one(c, `select public.fit_component_v2(p_site => $1, p_type => 'healing_abutment', p_fitted_on => public.cairo_today(),
                p_product => $2, p_lot => $3, p_by_delegate => null, p_by_organizer => $4, p_notes => '', p_course => null)`,
      [site, product, lot, users.admin]) as Promise<string>;

    const correct = (c: Client, site: string, lot: string | null, component: string | null, product: string | null, reason = 'lot found') =>
      c.query('select public.correct_batch($1, $2, $3, $4, $5)', [site, lot, reason, component, product]);

    async function refused(c: Client, fn: () => Promise<unknown>, message: string) {
      await c.query('savepoint s');
      await expect(fn()).rejects.toThrow(message);
      await c.query('rollback to savepoint s');
    }

    /** Movements of a site, counted past RLS (closed while Inventory is off). */
    async function movements(c: Client, site: string) {
      const role = (await c.query('select current_user as u')).rows[0].u as string;
      await c.query('reset role');
      const n = Number(await one(c, 'select count(*)::int from public.stock_movements where implant_site_id = $1', [site]));
      if (role !== 'postgres') await c.query(`set local role ${role}`);
      return n;
    }

    const asAdmin = (c: Client) => actAs(c, users.admin, { aal: 'aal2' });

    it('place without a lot while off', async () => {
      await withTx(async (c) => {
        const w = await world(c);
        await inventoryOff(c);
        await asAdmin(c);
        const site = await placeAt(c, w, 36, null);
        expect(await one(c, 'select stock_lot_id from public.implant_sites where id = $1', [site])).toBeNull();
        expect(await movements(c, site)).toBe(0);
      });
    });

    it('a lot is refused while off', async () => {
      await withTx(async (c) => {
        const w = await world(c);
        await inventoryOff(c);
        await asAdmin(c);
        await refused(c, () => placeAt(c, w, 36, w.lot), 'Stock batches are not used in your plan.');
      });
    });

    it('a lot is still required while on', async () => {
      await withTx(async (c) => {
        const w = await world(c);
        await refused(c, () => placeAt(c, w, 36, null), 'Choose a stock batch.');
      });
    });

    it('component without a lot while off', async () => {
      await withTx(async (c) => {
        const w = await world(c);
        await inventoryOff(c);
        await asAdmin(c);
        const site = await placeAt(c, w, 36, null);
        const comp = await fit(c, site, w.ha, null);
        expect(await one(c, 'select stock_lot_id from public.site_components where id = $1', [comp])).toBeNull();
        expect(await movements(c, site)).toBe(0);
        await refused(c, () => fit(c, site, w.ha, w.lot), 'Stock batches are not used in your plan.');
      });
    });

    it('a component still needs its lot while on', async () => {
      await withTx(async (c) => {
        const w = await world(c);
        const site = await placeAt(c, w, 36, w.lot);
        await refused(c, () => fit(c, site, w.ha, null), 'Choose the stock batch used.');
      });
    });

    it('product-only correction', async () => {
      await withTx(async (c) => {
        const w = await world(c);
        await inventoryOff(c);
        await asAdmin(c);
        const site = await placeAt(c, w, 36, null);
        await correct(c, site, null, null, w.other, 'wrong size');
        expect(await one(c, 'select product_id from public.implant_sites where id = $1', [site])).toBe(w.other);
        expect(await movements(c, site)).toBe(0);
        await refused(c, () => correct(c, site, null, null, w.other, 'again'), 'Choose a different');
      });
    });

    it('product-only correction refuses a non-implant', async () => {
      await withTx(async (c) => {
        const w = await world(c);
        await inventoryOff(c);
        await asAdmin(c);
        const site = await placeAt(c, w, 36, null);
        await refused(c, () => correct(c, site, null, null, w.ha, 'wrong size'), 'Choose an implant from the catalog.');
      });
    });

    it('product-only correction of a component', async () => {
      await withTx(async (c) => {
        const w = await world(c);
        const ha2 = await makeProduct(c, 'healing_abutment', 'Zz Inv HA2');
        await inventoryOff(c);
        await asAdmin(c);
        const site = await placeAt(c, w, 36, null);
        const comp = await fit(c, site, w.ha, null);
        await correct(c, site, null, comp, ha2, 'wrong height');
        expect(await one(c, 'select product_id from public.site_components where id = $1', [comp])).toBe(ha2);
        await refused(c, () => correct(c, site, null, comp, w.other, 'wrong'), 'That product is not a healing abutment.');
        expect(await movements(c, site)).toBe(0);
      });
    });

    it('attach later leaves stock unchanged', async () => {
      await withTx(async (c) => {
        const w = await world(c);
        await inventoryOff(c);
        await asAdmin(c);
        const site = await placeAt(c, w, 36, null);
        const later = await placeAt(c, w, 46, null);
        const comp = await fit(c, site, w.ha, null);

        await backToFull(c);
        await asAdmin(c);
        const haLot = await receive(c, w.ha, 2, 'ZZINVHA');
        const lot2 = await receive(c, w.product, 1, 'ZZINVLOT2');
        const before = await onHand(c, w.lot);
        await correct(c, site, w.lot, null, null);
        expect(await one(c, 'select stock_lot_id from public.implant_sites where id = $1', [site])).toBe(w.lot);
        expect(await onHand(c, w.lot)).toBe(before);
        await correct(c, site, haLot, comp, null);
        expect(await one(c, 'select stock_lot_id from public.site_components where id = $1', [comp])).toBe(haLot);
        expect(await onHand(c, haLot)).toBe(2);
        expect(await movements(c, site)).toBe(0);
        // A lot is never removed again.
        await refused(c, () => correct(c, site, null, null, w.other), 'Choose a different batch.');
        // The lot must be for the product.
        await refused(c, () => correct(c, later, haLot, null, null), 'That stock batch is for a different product.');

        await inventoryOff(c);
        await asAdmin(c);
        await refused(c, () => correct(c, later, w.lot, null, null), 'Inventory is not in your plan.');
        await refused(c, () => correct(c, site, lot2, null, null), 'Inventory is not in your plan.');
      });
    });

    it('a lot attached later can be corrected to another lot without changing stock (0113)', async () => {
      await withTx(async (c) => {
        const w = await world(c);
        await inventoryOff(c);
        await asAdmin(c);
        const site = await placeAt(c, w, 36, null);
        await backToFull(c);
        await asAdmin(c);
        const l2 = await receive(c, w.product, 2, 'ZZINVL2');
        const expired = await receive(c, w.product, 1, 'ZZINVOLD2', '2020-01-01');
        await correct(c, site, w.lot, null, null);
        await correct(c, site, l2, null, null, 'wrong lot');
        expect(await one(c, 'select stock_lot_id from public.implant_sites where id = $1', [site])).toBe(l2);
        expect(await onHand(c, w.lot)).toBe(3);
        expect(await onHand(c, l2)).toBe(2);
        expect(await movements(c, site)).toBe(0);
        await refused(c, () => correct(c, site, expired, null, null, 'wrong lot'), 'Lot ZZINVOLD2 had expired on 2020-01-01, before it was used.');
      });
    });

    it('attach later refuses a lot that expired before the placement', async () => {
      await withTx(async (c) => {
        const w = await world(c);
        const expired = await receive(c, w.product, 1, 'ZZINVOLD', '2020-01-01');
        await inventoryOff(c);
        await asAdmin(c);
        const site = await placeAt(c, w, 36, null);
        await backToFull(c);
        await asAdmin(c);
        await refused(c, () => correct(c, site, expired, null, null), 'Lot ZZINVOLD had expired on 2020-01-01, before it was used.');
      });
    });

    it('remove_placement returns stock while inventory is off', async () => {
      await withTx(async (c) => {
        const w = await world(c);
        const site = await placeAt(c, w, 36, w.lot);
        expect(await onHand(c, w.lot)).toBe(2);
        await inventoryOff(c);
        await asAdmin(c);
        await c.query('select public.remove_placement(p_site => $1, p_reason => $2)', [site, 'mistake']);
        await backToFull(c);
        await asAdmin(c);
        expect(await onHand(c, w.lot)).toBe(3);
      });
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

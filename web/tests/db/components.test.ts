import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs } from './helpers';
import { makeDelegate, makePatient, makeProduct, onHand, place, receive } from './fixtures';

const users = inject('testUsers');

async function placed(c: Client) {
  await actAs(c, users.organizer);
  const patient = await makePatient(c);
  const implant = await makeProduct(c);
  const lot = await receive(c, implant, 1, 'IMP');
  const delegate = await makeDelegate(c);
  const site = await place(c, { patient, tooth: 36, product: implant, lot, delegate, supervisor: users.organizer });
  return { patient, site, delegate, implantLot: lot };
}

async function fit(c: Client, site: string, type: string, product: string | null, lot: string | null, by: string) {
  const { rows } = await c.query(
    `select public.fit_component_v2(p_site => $1, p_type => $2, p_fitted_on => current_date,
       p_product => $3, p_lot => $4, p_by_delegate => $5, p_by_organizer => null, p_notes => '', p_course => null) as id`,
    [site, type, product, lot, by],
  );
  return rows[0].id as string;
}

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

describe('components', () => {
  it('fitting a component deducts stock and closes the previous component', async () => {
    await withTx(async (c) => {
      const s = await placed(c);
      const ha = await makeProduct(c, 'healing_abutment');
      const haLot = await receive(c, ha, 2, 'HA-1');
      const tb = await makeProduct(c, 'ti_base');
      const tbLot = await receive(c, tb, 1, 'TB-1');
      const first = await fit(c, s.site, 'healing_abutment', ha, haLot, s.delegate);
      const second = await fit(c, s.site, 'ti_base', tb, tbLot, s.delegate);
      expect(await onHand(c, haLot)).toBe(1);
      expect(await onHand(c, tbLot)).toBe(0);
      const { rows } = await c.query('select id, removed_on is null as current from public.site_components where site_id = $1 order by created_at', [s.site]);
      expect(rows).toEqual([{ id: first, current: false }, { id: second, current: true }]);
      const m = await c.query('select site_component_id, patient_id from public.stock_movements where stock_lot_id = $1 and reason = $2', [tbLot, 'use']);
      expect(m.rows).toEqual([{ site_component_id: second, patient_id: s.patient }]);
    });
  });

  it('a lab-made final restoration needs no product and marks the tooth restored', async () => {
    await withTx(async (c) => {
      const s = await placed(c);
      await fit(c, s.site, 'final_restoration', null, null, s.delegate);
      const site = await c.query('select state from public.implant_sites where id = $1', [s.site]);
      expect(site.rows[0].state).toBe('restored');
      const tooth = await c.query('select status from public.tooth_status where patient_id = $1 and tooth = 36', [s.patient]);
      expect(tooth.rows[0].status).toBe('restored');
    });
  });

  it('refuses mismatched products, a product without a batch, and nobody fitting it', async () => {
    await withTx(async (c) => {
      const s = await placed(c);
      const tb = await makeProduct(c, 'ti_base');
      const tbLot = await receive(c, tb, 1);
      await refused(c, () => fit(c, s.site, 'healing_abutment', tb, tbLot, s.delegate), /not a healing abutment/);
      await refused(c, () => fit(c, s.site, 'ti_base', tb, null, s.delegate), /Choose the stock batch used/);
      await refused(
        c,
        () => c.query("select public.fit_component_v2(p_site => $1, p_type => 'cover_screw', p_fitted_on => current_date, p_product => null, p_lot => null, p_by_delegate => null, p_by_organizer => null, p_notes => '', p_course => null)", [s.site]),
        /Choose who fitted the component/,
      );
    });
  });

  it('components need a placed implant', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const patient = await makePatient(c);
      const planned = (await c.query('select public.plan_implant($1, 11::smallint) as id', [patient])).rows[0].id;
      const delegate = await makeDelegate(c);
      await refused(c, () => fit(c, planned, 'cover_screw', null, null, delegate), /only be fitted to a placed implant/);
    });
  });
});

describe('follow-ups', () => {
  it('a failed follow-up marks the implant and tooth failed and frees the tooth', async () => {
    await withTx(async (c) => {
      const s = await placed(c);
      await c.query("select public.record_visit($1, public.cairo_today(), null, '2-week', 'attended', 'ok', '{}'::jsonb, '')", [s.site]);
      await c.query(
        `select public.record_visit($1, public.cairo_today(), null, '3-month', 'attended', 'failed', '{"failure_type":"lost","failure_reason":"no_osseointegration"}'::jsonb, 'Mobile')`,
        [s.site],
      );
      const site = await c.query('select state from public.implant_sites where id = $1', [s.site]);
      expect(site.rows[0].state).toBe('failed');
      const tooth = await c.query('select status from public.tooth_status where patient_id = $1 and tooth = 36', [s.patient]);
      expect(tooth.rows[0].status).toBe('failed');
      const again = await c.query('select public.plan_implant($1, 36::smallint) as id', [s.patient]);
      expect(again.rows[0].id).toBeTruthy();
    });
  });

  it('refuses follow-ups dated before placement or for planned implants', async () => {
    await withTx(async (c) => {
      const s = await placed(c);
      await refused(
        c,
        () => c.query("select public.record_visit($1, public.cairo_today() - 30, null, '2-week', 'attended', 'ok', '{}'::jsonb, '')", [s.site]),
        /cannot be before the implant was placed/,
      );
      const planned = (await c.query('select public.plan_implant($1, 11::smallint) as id', [s.patient])).rows[0].id;
      await refused(
        c,
        () => c.query("select public.record_visit($1, public.cairo_today(), null, 'x', 'attended', 'ok', '{}'::jsonb, '')", [planned]),
        /recorded for placed implants/,
      );
    });
  });
});

describe('recall', () => {
  it('lot_usage lists every patient, tooth, item and delegate a batch was used for', async () => {
    await withTx(async (c) => {
      const s = await placed(c);
      const { rows } = await c.query('select patient_id, tooth, item, placing_delegate, supervisor from public.lot_usage($1)', [s.implantLot]);
      expect(rows).toEqual([
        { patient_id: s.patient, tooth: 36, item: 'implant', placing_delegate: 'Test Delegate', supervisor: 'Test Organizer' },
      ]);
    });
  });
});

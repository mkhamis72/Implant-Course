import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs } from './helpers';
import { makeDelegate, makePatient, makeProduct, place, receive } from './fixtures';

const users = inject('testUsers');

async function day(c: Client, offset: number): Promise<string> {
  return (await c.query('select (public.cairo_today() + $1::int)::text as d', [offset])).rows[0].d;
}

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

describe('Cairo date', () => {
  it('cairo_today() is the calendar date in Cairo', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const { rows } = await c.query(
        "select public.cairo_today() = (now() at time zone 'Africa/Cairo')::date as same",
      );
      expect(rows[0].same).toBe(true);
    });
  });

  it('a placement dated tomorrow (Cairo) is refused', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const product = await makeProduct(c);
      const lot = await receive(c, product, 1);
      const [patient, delegate] = [await makePatient(c), await makeDelegate(c)];
      const tomorrow = await day(c, 1);
      await refused(
        c,
        () => place(c, { patient, tooth: 36, product, lot, delegate, supervisor: users.organizer, placedOn: tomorrow }),
        /date/i,
      );
    });
  });
});

describe('expiry is judged on the day of use', () => {
  it('recording a past placement with a batch that was in date then is accepted', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const product = await makeProduct(c);
      const lot = await receive(c, product, 1, 'EXP-LATER', await day(c, -5));
      const [patient, delegate] = [await makePatient(c), await makeDelegate(c)];
      await place(c, { patient, tooth: 36, product, lot, delegate, supervisor: users.organizer, placedOn: await day(c, -10) });
    });
  });

  it('a batch that had expired before the placement date is refused', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const product = await makeProduct(c);
      const lot = await receive(c, product, 1, 'EXP-OLD', await day(c, -10));
      const fiveAgo = await day(c, -5);
      const [patient, delegate] = [await makePatient(c), await makeDelegate(c)];
      await refused(
        c,
        () => place(c, { patient, tooth: 36, product, lot, delegate, supervisor: users.organizer, placedOn: fiveAgo }),
        /Lot EXP-OLD expired on/,
      );
    });
  });

  it('a component fitted while its batch was in date is accepted', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const implant = await makeProduct(c);
      const implantLot = await receive(c, implant, 1);
      const [patient, delegate] = [await makePatient(c), await makeDelegate(c)];
      const site = await place(c, { patient, tooth: 36, product: implant, lot: implantLot, delegate, supervisor: users.organizer, placedOn: await day(c, -20) });
      const ha = await makeProduct(c, 'healing_abutment');
      const haLot = await receive(c, ha, 1, 'HA-EXP', await day(c, -5));
      await c.query(
        "select public.fit_component_v2(p_site => $1, p_type => 'healing_abutment', p_fitted_on => $2::date, p_product => $3, p_lot => $4, p_by_delegate => $5, p_by_organizer => null, p_notes => '', p_course => null)",
        [site, await day(c, -10), ha, haLot, delegate],
      );
    });
  });
});

describe('failed teeth', () => {
  it('a failed tooth can be marked missing, but not set back to failed by hand', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const product = await makeProduct(c);
      const lot = await receive(c, product, 1);
      const [patient, delegate] = [await makePatient(c), await makeDelegate(c)];
      const site = await place(c, { patient, tooth: 36, product, lot, delegate, supervisor: users.organizer });
      await c.query(`select public.record_visit($1, public.cairo_today(), null, 'Review', 'attended', 'failed', '{"failure_type":"lost","failure_reason":"no_osseointegration"}'::jsonb, '')`, [site]);
      const upd = await c.query(
        "update public.tooth_status set status = 'missing' where patient_id = $1 and tooth = 36 returning status",
        [patient],
      );
      expect(upd.rows).toEqual([{ status: 'missing' }]);
      await refused(
        c,
        () => c.query("update public.tooth_status set status = 'failed' where patient_id = $1 and tooth = 36", [patient]),
        /row-level security/,
      );
    });
  });
});

describe('recall and history', () => {
  it('recall names who fitted a component, not who placed the implant', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const implant = await makeProduct(c);
      const implantLot = await receive(c, implant, 1);
      const patient = await makePatient(c);
      const placer = await makeDelegate(c, 'Dr Placer');
      const fitter = await makeDelegate(c, 'Dr Fitter');
      const site = await place(c, { patient, tooth: 36, product: implant, lot: implantLot, delegate: placer, supervisor: users.organizer });
      const ha = await makeProduct(c, 'healing_abutment');
      const haLot = await receive(c, ha, 1, 'HA-R');
      await c.query(
        "select public.fit_component_v2(p_site => $1, p_type => 'healing_abutment', p_fitted_on => public.cairo_today(), p_product => $2, p_lot => $3, p_by_delegate => $4, p_by_organizer => null, p_notes => '', p_course => null)",
        [site, ha, haLot, fitter],
      );
      const { rows } = await c.query('select placing_delegate from public.lot_usage($1)', [haLot]);
      expect(rows).toEqual([{ placing_delegate: 'Dr Fitter' }]);
    });
  });

  it("the patient's history includes components and follow-ups", async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const implant = await makeProduct(c);
      const lot = await receive(c, implant, 1);
      const [patient, delegate] = [await makePatient(c), await makeDelegate(c)];
      const site = await place(c, { patient, tooth: 36, product: implant, lot, delegate, supervisor: users.organizer });
      await c.query("select public.fit_component_v2(p_site => $1, p_type => 'cover_screw', p_fitted_on => public.cairo_today(), p_by_delegate => $2, p_product => null, p_lot => null, p_by_organizer => null, p_notes => '', p_course => null)", [site, delegate]);
      await c.query("select public.record_visit($1, public.cairo_today(), null, 'Review', 'attended', 'integrated', '{}'::jsonb, '')", [site]);
      const { rows } = await c.query('select distinct table_name from public.patient_history($1) order by 1', [patient]);
      expect(rows.map((r) => r.table_name)).toEqual(expect.arrayContaining(['implant_followups', 'site_components']));
    });
  });
});

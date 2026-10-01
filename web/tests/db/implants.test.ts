import { describe, it, expect, inject } from 'vitest';
import { Client } from 'pg';
import { pgConfig } from '../../scripts/db';
import { withTx, actAs, asPostgres } from './helpers';
import { makeDelegate, makePatient, makeProduct, onHand, place, receive } from './fixtures';

const users = inject('testUsers');

async function setup(c: Client) {
  await actAs(c, users.organizer);
  const patient = await makePatient(c);
  const product = await makeProduct(c);
  const lot = await receive(c, product, 2, 'IMP-1', '2031-01-01');
  const delegate = await makeDelegate(c, 'Dr Placing');
  return { patient, product, lot, delegate, supervisor: users.organizer };
}

async function toothStatus(c: Client, patient: string, tooth: number) {
  const { rows } = await c.query('select status from public.tooth_status where patient_id = $1 and tooth = $2', [patient, tooth]);
  return rows[0]?.status ?? 'present';
}

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

describe('placing an implant', () => {
  it('deducts one unit, links the patient, records who placed it and updates the chart', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const assistant = await makeDelegate(c, 'Dr Assisting');
      const site = await place(c, { ...s, tooth: 36, assistant });
      expect(await onHand(c, s.lot)).toBe(1);
      const { rows } = await c.query(
        'select state, placing_delegate_id, assisting_delegate_id, supervisor_id, stock_lot_id from public.implant_sites where id = $1',
        [site],
      );
      expect(rows[0]).toEqual({
        state: 'placed', placing_delegate_id: s.delegate, assisting_delegate_id: assistant,
        supervisor_id: users.organizer, stock_lot_id: s.lot,
      });
      const m = await c.query("select patient_id, implant_site_id, delta from public.stock_movements where reason = 'use' and stock_lot_id = $1", [s.lot]);
      expect(m.rows).toEqual([{ patient_id: s.patient, implant_site_id: site, delta: -1 }]);
      expect(await toothStatus(c, s.patient, 36)).toBe('implant_placed');
    });
  });

  it('a batch without a lot number or expiry is accepted', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const bare = await receive(c, s.product, 1, null, null);
      await place(c, { ...s, lot: bare, tooth: 46 });
      expect(await onHand(c, bare)).toBe(0);
    });
  });

  it('refuses an expired, wrong-product or empty batch', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const expired = await receive(c, s.product, 1, 'OLD-1', '2020-01-31');
      await refused(c, () => place(c, { ...s, lot: expired, tooth: 11 }), /Lot OLD-1 expired on 2020-01-31/);
      const other = await receive(c, await makeProduct(c), 1, 'OTHER');
      await refused(c, () => place(c, { ...s, lot: other, tooth: 11 }), /different product/);
      const single = await receive(c, s.product, 1, 'ONE');
      await place(c, { ...s, lot: single, tooth: 11 });
      await refused(c, () => place(c, { ...s, lot: single, tooth: 21 }), /This stock batch is empty/);
    });
  });

  it('requires an active placing delegate, a different assistant and an active supervisor', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await refused(c, () => place(c, { ...s, tooth: 36, assistant: s.delegate }), /someone other than the placing delegate/);
      await refused(c, () => place(c, { ...s, tooth: 36, supervisor: users.inactive }), /Choose the supervising organizer/);
      await c.query('update public.delegates set active = false where id = $1', [s.delegate]);
      await refused(c, () => place(c, { ...s, tooth: 36 }), /Choose the delegate who placed the implant/);
    });
  });

  it('one implant per tooth; a planned implant is completed by placement', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const planned = (await c.query('select public.plan_implant($1, 36::smallint, $2) as id', [s.patient, s.product])).rows[0].id;
      expect(await toothStatus(c, s.patient, 36)).toBe('implant_planned');
      const site = await place(c, { ...s, tooth: 36 });
      expect(site).toBe(planned);
      await refused(c, () => place(c, { ...s, tooth: 36 }), /Tooth 36 already has an implant/);
      await refused(
        c,
        () => c.query('select public.plan_implant($1, 36::smallint)', [s.patient]),
        /Tooth 36 already has an implant record/,
      );
    });
  });

  it('a cancelled plan frees the tooth and marks it missing', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const planned = (await c.query('select public.plan_implant($1, 24::smallint) as id', [s.patient])).rows[0].id;
      await c.query('select public.cancel_planned_implant($1)', [planned]);
      expect(await toothStatus(c, s.patient, 24)).toBe('missing');
      const site = await place(c, { ...s, tooth: 24 });
      expect(site).not.toBe(planned);
    });
  });

  it('users cannot write implant tables directly', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await refused(
        c,
        () => c.query("insert into public.implant_sites (patient_id, tooth, state) values ($1, 36, 'planned')", [s.patient]),
        /permission denied/,
      );
    });
  });

  it('2FA user with aal1 cannot place', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await asPostgres(c);
      await c.query(
        `insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
         values (gen_random_uuid(), $1, 't', 'totp', 'verified', now(), now(), 'x')`,
        [users.organizer],
      );
      await actAs(c, users.organizer, { aal: 'aal1' });
      await expect(place(c, { ...s, tooth: 36 })).rejects.toThrow(/Not allowed/);
    });
  });

  it('placements show up in the patient history', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await place(c, { ...s, tooth: 36 });
      const { rows } = await c.query("select table_name from public.patient_history($1) where table_name = 'implant_sites'", [s.patient]);
      expect(rows.length).toBeGreaterThan(0);
    });
  });
});

describe('concurrency', () => {
  it('concurrent placement waits for the batch lock', async () => {
    // Setup is committed so a second connection can see it; the ledger keeps these rows.
    const a = new Client(pgConfig());
    const b = new Client(pgConfig());
    await a.connect();
    await b.connect();
    try {
      await a.query('begin');
      await actAs(a, users.organizer);
      const s1 = await setup(a);
      const p2 = await makePatient(a, 'Second Patient');
      await a.query('commit');

      await a.query('begin');
      await actAs(a, users.organizer);
      await place(a, { ...s1, tooth: 36 }); // holds the batch row lock

      await b.query('begin');
      await actAs(b, users.organizer);
      await b.query("set local statement_timeout = '2s'");
      await expect(place(b, { ...s1, patient: p2, tooth: 36 })).rejects.toThrow(/statement timeout/);
      await b.query('rollback');
      await a.query('rollback');
    } finally {
      await a.end();
      await b.end();
    }
  });
});

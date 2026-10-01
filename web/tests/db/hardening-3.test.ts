import { describe, it, expect, inject } from 'vitest';
import { Client } from 'pg';
import { pgConfig } from '../../scripts/db';
import { withTx, actAs, asPostgres } from './helpers';
import { makeDelegate, makePatient, makeProduct, place, receive } from './fixtures';

const users = inject('testUsers');

describe('I1: same-batch placements never deadlock', () => {
  it('the second organizer is told the batch is empty, not "something went wrong"', async () => {
    const setup = new Client(pgConfig());
    const a = new Client(pgConfig());
    const b = new Client(pgConfig());
    await Promise.all([setup.connect(), a.connect(), b.connect()]);
    let product = '';
    let delegate = '';
    try {
      await setup.query('begin');
      await actAs(setup, users.organizer);
      const patientA = await makePatient(setup, 'E2E Deadlock A');
      const patientB = await makePatient(setup, 'E2E Deadlock B');
      product = await makeProduct(setup, 'implant', 'E2E Deadlock Brand');
      const lot = await receive(setup, product, 1, 'E2E-DL');
      delegate = await makeDelegate(setup, 'E2E Deadlock Delegate');
      await setup.query('commit');
      const args = { product, lot, delegate, supervisor: users.organizer, tooth: 36 };

      // A holds the key-share lock a foreign-key check would take on the batch row.
      await a.query('begin');
      await asPostgres(a);
      await a.query('select 1 from public.stock_lots where id = $1 for key share', [lot]);
      await actAs(a, users.organizer);

      // B starts placing from the same batch and has to wait for A.
      await b.query('begin');
      await actAs(b, users.organizer);
      const bResult = place(b, { ...args, patient: patientB }).then(
        () => 'ok',
        (e: Error) => e.message,
      );
      await new Promise((r) => setTimeout(r, 1500));

      // A now places too: it must win, and B must then see an empty batch.
      await place(a, { ...args, patient: patientA });
      await a.query('commit');
      expect(await bResult).toMatch(/This stock batch is empty/);
      await b.query('rollback');
    } finally {
      await a.query('rollback').catch(() => {});
      await b.query('rollback').catch(() => {});
      if (product) await setup.query('update public.products set active = false where id = $1', [product]).catch(() => {});
      if (delegate) await setup.query('update public.delegates set active = false where id = $1', [delegate]).catch(() => {});
      await Promise.all([setup.end(), a.end(), b.end()]);
    }
  });
});

describe('I2: products already used cannot be retyped or resized', () => {
  async function refused(c: Client, sql: string, params: unknown[], pattern: RegExp) {
    await c.query('savepoint s');
    await expect(c.query(sql, params)).rejects.toThrow(pattern);
    await c.query('rollback to savepoint s');
  }

  it('type is frozen once stock exists; size and brand once used for a patient', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const product = await makeProduct(c);
      await c.query("update public.products set diameter_mm = 4.5 where id = $1", [product]); // no stock yet: fine
      const lot = await receive(c, product, 2);
      await refused(c, "update public.products set type = 'cover_screw', diameter_mm = null, length_mm = null where id = $1", [product], /type cannot change/);
      await c.query("update public.products set diameter_mm = 4.0 where id = $1", [product]); // stocked but unused: fine
      await place(c, { patient: await makePatient(c), tooth: 36, product, lot, delegate: await makeDelegate(c), supervisor: users.organizer });
      await refused(c, 'update public.products set diameter_mm = 6 where id = $1', [product], /has been used for patients/);
      await refused(c, "update public.products set brand = 'Other' where id = $1", [product], /has been used for patients/);
      await c.query(
        "update public.products set ref_code = 'REF-1', description = 'Verified', reorder_level = 3, is_sample = false, active = false where id = $1",
        [product],
      );
    });
  });
});

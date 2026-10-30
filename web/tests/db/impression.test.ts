import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { legacyFailure, makeDelegate, makePatient, makeProduct, place, receive } from './fixtures';

const users = inject('testUsers');

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

async function setup(c: Client) {
  await actAs(c, users.organizer);
  const implant = await makeProduct(c);
  const lot = await receive(c, implant, 20, 'IMPR');
  const delegate = await makeDelegate(c, 'Zz Impression Delegate');
  const placeOn = (patient: string, tooth: number, placedOn = '2026-03-10') =>
    place(c, { patient, tooth, product: implant, lot, delegate, supervisor: users.organizer, placedOn });
  const fit = async (site: string, type: string) => {
    const product = type === 'final_restoration' ? null : await makeProduct(c, type);
    const fitLot = product ? await receive(c, product, 1, `${type}-lot`) : null;
    await c.query(
      `select public.fit_component_v2(p_site => $1, p_type => $2, p_fitted_on => current_date,
         p_product => $3, p_lot => $4, p_by_delegate => $5, p_by_organizer => null, p_notes => '', p_course => null)`,
      [site, type, product, fitLot, delegate],
    );
  };
  return { placeOn, fit };
}

const updatedAt = async (c: Client, site: string) =>
  (await c.query('select updated_at::text as t from public.implant_sites where id = $1', [site])).rows[0].t as string;
const record = async (c: Client, site: string, type: string | null, on: string | null, expected?: string) =>
  c.query('select public.record_impression($1, $2, $3::date, $4::timestamptz)', [
    site, type, on, expected ?? (await updatedAt(c, site)),
  ]);
const read = async (c: Client, site: string) =>
  (await c.query('select impression_type, impression_taken_on::text as impression_taken_on from public.implant_sites where id = $1', [site])).rows[0];

async function search(c: Client, q: string, stages: string[]): Promise<string[]> {
  const { rows } = await c.query('select full_name from public.search_patients(q => $1, stages => $2)', [q, stages]);
  return rows.map((r) => r.full_name);
}

describe('record_impression', () => {
  it('records a digital scan with its date', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await s.placeOn(await makePatient(c, 'Zz Impression One'), 46);
      await record(c, site, 'digital_scan', '2026-03-10');
      expect(await read(c, site)).toEqual({ impression_type: 'digital_scan', impression_taken_on: '2026-03-10' });
    });
  });

  it('clears both when the type is null, even with a date', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await s.placeOn(await makePatient(c, 'Zz Impression Clear'), 46);
      await record(c, site, 'conventional', '2026-03-11');
      await record(c, site, null, '2026-03-12');
      expect(await read(c, site)).toEqual({ impression_type: null, impression_taken_on: null });
    });
  });

  it('refuses a bad date, a planned or removed implant and a stale version', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const patient = await makePatient(c, 'Zz Impression Refuse');
      const site = await s.placeOn(patient, 46);
      await refused(c, () => record(c, site, 'digital_scan', '2026-03-09'), /before the placement date/);
      await refused(c, async () => {
        const future = (await c.query(`select (public.cairo_today() + 1)::text as d`)).rows[0].d;
        return record(c, site, 'digital_scan', future);
      }, /future/);
      await refused(c, () => record(c, site, 'digital_scan', '2026-03-12', '2026-01-01T00:00:00Z'), /changed by someone else/);
      const planned = (await c.query('select public.plan_implant($1, 11::smallint) as id', [patient])).rows[0].id;
      await refused(c, () => record(c, planned, 'digital_scan', '2026-03-12'), /placed implant/);
      const gone = await s.placeOn(patient, 47);
      await asPostgres(c);
      await c.query(`update public.implant_sites set state = 'removed' where id = $1`, [gone]);
      await actAs(c, users.organizer);
      await refused(c, () => record(c, gone, 'digital_scan', '2026-03-12'), /placed implant/);
    });
  });

  it('needs Edit on Patients', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await s.placeOn(await makePatient(c, 'Zz Impression Perm'), 46);
      const v = await updatedAt(c, site);
      await actAs(c, users.viewer);
      await refused(c, () => record(c, site, 'digital_scan', '2026-03-12', v), /permission to edit Patients/);
    });
  });
});

describe('patient filter by scan / impression', () => {
  it('matches the recorded type and the pending state', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const a = await makePatient(c, 'Zz Impression A');
      const a1 = await s.placeOn(a, 36);
      const a2 = await s.placeOn(a, 37);
      await s.fit(a1, 'cover_screw');
      await s.fit(a2, 'cover_screw');
      await record(c, a1, 'digital_scan', '2026-03-12');
      const b = await makePatient(c, 'Zz Impression B');
      const b1 = await s.placeOn(b, 46);
      await record(c, b1, 'conventional', '2026-03-12');
      const cc = await makePatient(c, 'Zz Impression C');
      const c1 = await s.placeOn(cc, 14);
      await legacyFailure(c, c1, '2026-03-20', users.organizer);
      const d = await makePatient(c, 'Zz Impression D');
      await s.fit(await s.placeOn(d, 25), 'final_restoration');

      const digital = await search(c, 'Zz Impression', ['digital_scan']);
      expect(digital).toContain('Zz Impression A');
      expect(digital).not.toContain('Zz Impression B');
      const pending = await search(c, 'Zz Impression', ['impression_pending']);
      expect(pending).toContain('Zz Impression A');
      expect(pending).not.toContain('Zz Impression B');
      expect(pending).not.toContain('Zz Impression C');
      expect(pending).not.toContain('Zz Impression D');
      expect(await search(c, 'Zz Impression', ['conventional'])).toEqual(['Zz Impression B']);
      await asPostgres(c);
    });
  });
});

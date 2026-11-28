import type { Client } from 'pg';
import { describe, it, expect, inject } from 'vitest';
import { withTx, actAs, asPostgres } from './helpers';
import { makeDelegate, makePatient, makeProduct, place, receive } from './fixtures';

const users = inject('testUsers');

async function one<T = Record<string, unknown>>(c: Client, sql: string, params: unknown[] = []): Promise<T> {
  return (await c.query(sql, params)).rows[0] as T;
}

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

async function setup(c: Client) {
  await actAs(c, users.organizer);
  const patient = await makePatient(c, 'Zz Screw Size Patient');
  const implant = await makeProduct(c, 'implant', 'Zz Screw Size Brand');
  const lot = await receive(c, implant, 5, 'ZZSS');
  const delegate = await makeDelegate(c, 'Zz Screw Size Delegate');
  const site = await place(c, { patient, tooth: 36, product: implant, lot, delegate, supervisor: users.organizer });
  await actAs(c, users.admin);
  const size = async (kind: string, label: string) =>
    (await one<{ id: string }>(c, 'select public.save_screw_size(null, $1, $2, $3, $4, $5, $6, $7, $8) as id',
      ['Zz Screw Size Brand', 'Zz System', kind, label, 'Hex', '1.25 mm', 'DRV', 25])).id;
  const abut = await size('abutment_screw', 'M1.6 x 7');
  const pros = await size('prosthetic_screw', 'M1.4 x 5');
  const off = await size('abutment_screw', 'M1.6 x 9');
  await asPostgres(c);
  await c.query('update public.screw_sizes set active = false where id = $1', [off]);
  await actAs(c, users.organizer);
  return { site, abut, pros, off };
}

const fit4 = (c: Client, site: string, type: string, size: string | null, holds: string | null = null) =>
  one<{ id: string }>(c,
    `select public.fit_component_v4(p_site => $1, p_type => $2::public.component_type, p_fitted_on => public.cairo_today(),
       p_product => null, p_lot => null, p_by_delegate => null, p_by_organizer => $3, p_notes => '', p_course => null,
       p_torque => null, p_holds_component => $4, p_holds_restoration => null, p_screw_size => $5) as id`,
    [site, type, users.organizer, holds, size]);

const abutmentOn = async (c: Client, site: string) => (await fit4(c, site, 'ti_base', null)).id;

describe('fit_component_v4: screw size (0149)', () => {
  it('stores an abutment-screw size on an abutment screw', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const abutment = await abutmentOn(c, s.site);
      const { id } = await fit4(c, s.site, 'abutment_screw', s.abut, abutment);
      expect(await one(c, 'select screw_size_id from public.site_components where id = $1', [id]))
        .toEqual({ screw_size_id: s.abut });
    });
  });

  it('refuses a prosthetic size on an abutment screw', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const abutment = await abutmentOn(c, s.site);
      await refused(c, () => fit4(c, s.site, 'abutment_screw', s.pros, abutment), /This size is for another kind of screw\./);
    });
  });

  it('refuses a size on a healing abutment', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await refused(c, () => fit4(c, s.site, 'healing_abutment', s.abut), /A size is only for a screw\./);
    });
  });

  it('refuses a switched-off size', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const abutment = await abutmentOn(c, s.site);
      await refused(c, () => fit4(c, s.site, 'abutment_screw', s.off, abutment), /Choose an active screw size\./);
    });
  });

  it('fits with no size, and v3 still works', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const abutment = await abutmentOn(c, s.site);
      const { id } = await fit4(c, s.site, 'abutment_screw', null, abutment);
      expect(await one(c, 'select screw_size_id from public.site_components where id = $1', [id]))
        .toEqual({ screw_size_id: null });
      const v3 = await one<{ id: string }>(c,
        `select public.fit_component_v3(p_site => $1, p_type => 'healing_abutment', p_fitted_on => public.cairo_today(),
           p_product => null, p_lot => null, p_by_delegate => null, p_by_organizer => $2, p_notes => '', p_course => null,
           p_torque => null, p_holds_component => null, p_holds_restoration => null) as id`, [s.site, users.organizer]);
      expect(v3.id).toBeTruthy();
    });
  });
});

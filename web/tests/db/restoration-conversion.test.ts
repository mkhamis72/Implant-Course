import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { makeDelegate, makePatient, makeProduct, place, receive } from './fixtures';

const users = inject('testUsers');

const daysAgo = async (c: Client, n: number) =>
  (await c.query('select (public.cairo_today() - $1::int)::text as d', [n])).rows[0].d as string;

async function setup(c: Client) {
  await actAs(c, users.organizer);
  const implant = await makeProduct(c);
  const lot = await receive(c, implant, 5, 'CNV');
  const delegate = await makeDelegate(c, 'Zz Convert Delegate');
  const patient = await makePatient(c, 'Zz Convert Patient');
  const site = await place(c, {
    patient, tooth: 36, product: implant, lot, delegate, supervisor: users.organizer, placedOn: await daysAgo(c, 60),
  });
  return { patient, delegate, site };
}

async function fit(c: Client, site: string, type: string, daysBack: number, by: string) {
  const { rows } = await c.query(
    `select public.fit_component(p_site => $1, p_type => $2::public.component_type,
       p_fitted_on => public.cairo_today() - $3::int, p_by_delegate => $4) as id`,
    [site, type, daysBack, by],
  );
  return rows[0].id as string;
}

async function convert(c: Client): Promise<number> {
  await asPostgres(c);
  return (await c.query('select app_private.convert_final_restorations() as n')).rows[0].n as number;
}

const restosOf = async (c: Client, site: string) =>
  (await c.query(
    `select r.id, r.stage, r.type, r.teeth, r.fitted_on::text, r.delegate_id, r.retention, r.material, r.notes,
            r.ended_on::text, r.end_kind, r.end_reason, r.ended_by
     from public.restoration_sites rs join public.restorations r on r.id = rs.restoration_id
     where rs.site_id = $1 order by r.fitted_on`,
    [site],
  )).rows;

describe('convert_final_restorations', () => {
  it('converts a current final restoration', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await fit(c, s.site, 'final_restoration', 10, s.delegate);
      const fittedOn = await daysAgo(c, 10);
      expect(await convert(c)).toBeGreaterThanOrEqual(1);
      const rows = await restosOf(c, s.site);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        stage: 'final', type: 'single_crown', teeth: [36], fitted_on: fittedOn, delegate_id: s.delegate,
        retention: null, material: null, notes: 'Converted from a fitted final restoration.',
        ended_on: null, end_kind: null, end_reason: null, ended_by: null,
      });
    });
  });

  it('converts a remade chain', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await fit(c, s.site, 'final_restoration', 20, s.delegate);
      await fit(c, s.site, 'final_restoration', 5, s.delegate);
      await convert(c);
      const rows = await restosOf(c, s.site);
      expect(rows).toHaveLength(2);
      const [a, b] = rows;
      expect(a).toMatchObject({
        ended_on: await daysAgo(c, 5), end_kind: 'remade', end_reason: 'not recorded', ended_by: b.id,
      });
      expect(b).toMatchObject({ ended_on: null, end_kind: null, ended_by: null });
    });
  });

  it('skips a crown followed by a healing abutment', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await fit(c, s.site, 'final_restoration', 20, s.delegate);
      await fit(c, s.site, 'healing_abutment', 5, s.delegate);
      await convert(c);
      expect(await restosOf(c, s.site)).toHaveLength(0);
    });
  });

  it('is idempotent', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await fit(c, s.site, 'final_restoration', 20, s.delegate);
      await fit(c, s.site, 'final_restoration', 5, s.delegate);
      expect(await convert(c)).toBeGreaterThanOrEqual(2);
      expect(await convert(c)).toBe(0);
      expect(await restosOf(c, s.site)).toHaveLength(2);
    });
  });

  it('leaves implant state and components unchanged', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      await fit(c, s.site, 'final_restoration', 10, s.delegate);
      const snap = async () => ({
        site: (await c.query('select * from public.implant_sites where id = $1', [s.site])).rows,
        comps: (await c.query('select * from public.site_components where site_id = $1 order by id', [s.site])).rows,
        tooth: (await c.query('select status from public.tooth_status where patient_id = $1', [s.patient])).rows,
      });
      const before = await snap();
      await convert(c);
      expect(await snap()).toEqual(before);
      expect(before.site[0].state).toBe('restored');
    });
  });

  // Fitting rows in one transaction gives them the same created_at; spread them so the window order is the fit order.
  const ageComponents = async (c: Client, ids: string[]) => {
    await asPostgres(c);
    for (const [i, id] of ids.entries()) {
      await c.query(
        'update public.site_components set created_at = now() - make_interval(mins => $2::int) where id = $1',
        [id, ids.length - i],
      );
    }
    await actAs(c, users.organizer);
  };

  it('converts a same-day pair: the newer crown is current, the older one remade by it', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const older = await fit(c, s.site, 'final_restoration', 5, s.delegate);
      const newer = await fit(c, s.site, 'final_restoration', 5, s.delegate);
      await ageComponents(c, [older, newer]);
      expect(await convert(c)).toBeGreaterThanOrEqual(2);
      const rows = await restosOf(c, s.site);
      expect(rows).toHaveLength(2);
      const current = rows.filter((r) => r.ended_on === null);
      expect(current).toHaveLength(1);
      const remade = rows.find((r) => r.ended_on !== null);
      expect(remade).toMatchObject({
        ended_on: await daysAgo(c, 5), end_kind: 'remade', end_reason: 'not recorded', ended_by: current[0].id,
      });
      expect(await convert(c)).toBe(0);
    });
  });

  it('converts a 3-crown chain with a same-day tail', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const a = await fit(c, s.site, 'final_restoration', 20, s.delegate);
      const b = await fit(c, s.site, 'final_restoration', 5, s.delegate);
      const last = await fit(c, s.site, 'final_restoration', 5, s.delegate);
      await ageComponents(c, [a, b, last]);
      expect(await convert(c)).toBeGreaterThanOrEqual(3);
      const rows = await restosOf(c, s.site);
      expect(rows).toHaveLength(3);
      const current = rows.filter((r) => r.ended_on === null);
      expect(current).toHaveLength(1);
      const first = rows.find((r) => r.fitted_on === rows[0].fitted_on && r.id !== current[0].id);
      expect(first?.fitted_on).toBe(await daysAgo(c, 20));
      const middle = rows.find((r) => r.id !== first?.id && r.id !== current[0].id);
      expect(middle).toMatchObject({ end_kind: 'remade', ended_by: current[0].id, ended_on: await daysAgo(c, 5) });
      expect(first).toMatchObject({ end_kind: 'remade', ended_by: middle?.id, ended_on: await daysAgo(c, 5) });
      expect(await convert(c)).toBe(0);
    });
  });

  it('skips a removed crown with no successor', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const id = await fit(c, s.site, 'final_restoration', 10, s.delegate);
      await asPostgres(c);
      await c.query('update public.site_components set removed_on = public.cairo_today() - 2 where id = $1', [id]);
      expect(await convert(c)).toBe(0);
      expect(await restosOf(c, s.site)).toHaveLength(0);
    });
  });
});

import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { makeDelegate, makePatient, makeProduct, place, receive } from './fixtures';

const users = inject('testUsers');

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

const daysAgo = async (c: Client, n: number) =>
  (await c.query('select (public.cairo_today() - $1::int)::text as d', [n])).rows[0].d as string;

async function setup(c: Client, name = 'Zz Resto Patient') {
  await actAs(c, users.organizer);
  const implant = await makeProduct(c);
  const lot = await receive(c, implant, 10, 'RST');
  const delegate = await makeDelegate(c, 'Zz Resto Delegate');
  const patient = await makePatient(c, name);
  const placedOn = await daysAgo(c, 60);
  const placeAt = (tooth: number) =>
    place(c, { patient, tooth, product: implant, lot, delegate, supervisor: users.organizer, placedOn });
  return { patient, delegate, placedOn, placeAt };
}

type Add = {
  stage?: string; type?: string; sites: string[]; teeth?: number[] | null; fittedOn?: string;
  retention?: string | null; material?: string | null; delegate?: string | null; supervisor?: string | null;
  course?: string | null; reason?: string | null; notes?: string | null;
};

const add = async (c: Client, patient: string, a: Add) =>
  (await c.query(
    `select public.add_restoration(p_patient => $1, p_stage => $2, p_type => $3, p_sites => $4::uuid[],
       p_teeth => $5::smallint[], p_fitted_on => coalesce($6::date, public.cairo_today()), p_retention => $7,
       p_material => $8, p_delegate => $9, p_supervisor => $10, p_course => $11, p_remake_reason => $12,
       p_notes => $13) as id`,
    [patient, a.stage ?? 'final', a.type ?? 'single_crown', a.sites, a.teeth ?? null, a.fittedOn ?? null,
     a.retention ?? null, a.material ?? null, a.delegate ?? null, a.supervisor ?? null, a.course ?? null,
     a.reason ?? null, a.notes ?? null],
  )).rows[0].id as string;

const voidIt = (c: Client, id: string, reason: string) =>
  c.query('select public.void_restoration($1, $2)', [id, reason]);

const stateOf = async (c: Client, site: string) =>
  (await c.query('select state from public.implant_sites where id = $1', [site])).rows[0].state as string;
const toothOf = async (c: Client, patient: string, tooth: number) =>
  (await c.query('select status from public.tooth_status where patient_id = $1 and tooth = $2', [patient, tooth])).rows[0]
    ?.status as string | undefined;
const resto = async (c: Client, id: string) =>
  (await c.query(
    `select stage, type, teeth, fitted_on::text, retention, material, delegate_id, supervisor_id, course_id, notes,
            ended_on::text, end_kind, end_reason, ended_by, voided_at, voided_reason, updated_at::text as updated_at
     from public.restorations where id = $1`,
    [id],
  )).rows[0];

describe('add_restoration', () => {
  it('a final single crown restores its implant', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await s.placeAt(36);
      const id = await add(c, s.patient, { sites: [site], material: 'zirconia', retention: 'screw' });
      expect(await stateOf(c, site)).toBe('restored');
      expect(await toothOf(c, s.patient, 36)).toBe('restored');
      const r = await resto(c, id);
      expect(r).toMatchObject({ stage: 'final', type: 'single_crown', teeth: [36], material: 'zirconia', retention: 'screw', ended_on: null });
      const links = await c.query('select site_id from public.restoration_sites where restoration_id = $1', [id]);
      expect(links.rows).toEqual([{ site_id: site }]);
    });
  });

  it('a temporary does not restore', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await s.placeAt(36);
      await add(c, s.patient, { stage: 'temporary', sites: [site] });
      expect(await stateOf(c, site)).toBe('placed');
      expect(await toothOf(c, s.patient, 36)).toBe('implant_placed');
    });
  });

  it('a bridge covers its pontic', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const a = await s.placeAt(34);
      const b = await s.placeAt(36);
      const id = await add(c, s.patient, { type: 'bridge', sites: [b, a], teeth: [36, 35, 34] });
      expect((await resto(c, id)).teeth).toEqual([34, 35, 36]);
      expect(await stateOf(c, a)).toBe('restored');
      expect(await stateOf(c, b)).toBe('restored');
    });
  });

  it('refuses teeth that are not contiguous or miss an implant', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const a = await s.placeAt(34);
      const b = await s.placeAt(36);
      await refused(c, () => add(c, s.patient, { type: 'bridge', sites: [a, b], teeth: [34, 36] }), /teeth/i);
      await refused(c, () => add(c, s.patient, { type: 'bridge', sites: [a, b], teeth: [34, 35] }), /teeth/i);
      await refused(c, () => add(c, s.patient, { type: 'bridge', sites: [a, b], teeth: [34, 35, 35, 36] }), /teeth/i);
      await refused(c, () => add(c, s.patient, { type: 'bridge', sites: [a, b], teeth: null }), /teeth/i);
      // Across the midline is one run in arch order.
      const u1 = await s.placeAt(11);
      const u2 = await s.placeAt(21);
      await add(c, s.patient, { type: 'bridge', sites: [u1, u2], teeth: [21, 11] });
      expect(await stateOf(c, u1)).toBe('restored');
    });
  });

  it('refuses mixed jaws', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const a = await s.placeAt(36);
      const b = await s.placeAt(26);
      await refused(c, () => add(c, s.patient, { type: 'full_arch', sites: [a, b], teeth: [26, 36] }), /jaw/i);
    });
  });

  it('refuses a bridge on one implant and a single crown on two implants', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const a = await s.placeAt(34);
      const b = await s.placeAt(35);
      await refused(c, () => add(c, s.patient, { type: 'bridge', sites: [a], teeth: [34, 35] }), /at least two/i);
      await refused(c, () => add(c, s.patient, { type: 'single_crown', sites: [a, b] }), /one implant/i);
      await refused(c, () => add(c, s.patient, { type: 'single_crown', sites: [a], teeth: [35] }), /own tooth/i);
    });
  });

  it('refuses unknown values', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const a = await s.placeAt(34);
      await refused(c, () => add(c, s.patient, { stage: 'interim', sites: [a] }), /temporary or final/i);
      await refused(c, () => add(c, s.patient, { type: 'veneer', sites: [a] }), /type/i);
      await refused(c, () => add(c, s.patient, { sites: [a], retention: 'glue' }), /retention/i);
      await refused(c, () => add(c, s.patient, { sites: [a], material: 'gold' }), /material/i);
    });
  });

  it('a final replaces a temporary', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await s.placeAt(36);
      const temp = await add(c, s.patient, { stage: 'temporary', sites: [site], fittedOn: await daysAgo(c, 30) });
      const fitted = await daysAgo(c, 5);
      const fin = await add(c, s.patient, { sites: [site], fittedOn: fitted });
      expect(await resto(c, temp)).toMatchObject({ end_kind: 'replaced', ended_on: fitted, ended_by: fin, end_reason: null });
      expect(await stateOf(c, site)).toBe('restored');
      // A temporary over a temporary is replaced too.
      const site2 = await s.placeAt(46);
      const t1 = await add(c, s.patient, { stage: 'temporary', sites: [site2], fittedOn: await daysAgo(c, 20) });
      await add(c, s.patient, { stage: 'temporary', sites: [site2], fittedOn: await daysAgo(c, 10) });
      expect((await resto(c, t1)).end_kind).toBe('replaced');
      expect(await stateOf(c, site2)).toBe('placed');
    });
  });

  it('a final over a final needs a reason', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await s.placeAt(36);
      const old = await add(c, s.patient, { sites: [site], fittedOn: await daysAgo(c, 30) });
      await refused(c, () => add(c, s.patient, { sites: [site] }), /why/i);
      await refused(c, () => add(c, s.patient, { sites: [site], reason: '   ' }), /why/i);
      await add(c, s.patient, { sites: [site], reason: ' Fractured ' });
      expect(await resto(c, old)).toMatchObject({ end_kind: 'remade', end_reason: 'Fractured' });
      expect(await stateOf(c, site)).toBe('restored');
    });
  });

  it('refuses a temporary over a final', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await s.placeAt(36);
      await add(c, s.patient, { sites: [site], fittedOn: await daysAgo(c, 30) });
      await refused(c, () => add(c, s.patient, { stage: 'temporary', sites: [site] }), /Record the repair as a problem/);
    });
  });

  it('partial overlap ends the bridge completely', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const a = await s.placeAt(34);
      const b = await s.placeAt(36);
      const bridge = await add(c, s.patient, { type: 'bridge', sites: [a, b], teeth: [34, 35, 36], fittedOn: await daysAgo(c, 30) });
      await add(c, s.patient, { sites: [b], reason: 'Bridge fractured' });
      expect(await resto(c, bridge)).toMatchObject({ end_kind: 'remade', end_reason: 'Bridge fractured' });
      expect(await stateOf(c, a)).toBe('placed');
      expect(await toothOf(c, s.patient, 34)).toBe('implant_placed');
      expect(await stateOf(c, b)).toBe('restored');
      expect(await toothOf(c, s.patient, 36)).toBe('restored');
    });
  });

  it('undo reopens what it ended', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const a = await s.placeAt(34);
      const b = await s.placeAt(36);
      const bridge = await add(c, s.patient, { type: 'bridge', sites: [a, b], teeth: [34, 35, 36], fittedOn: await daysAgo(c, 30) });
      const crown = await add(c, s.patient, { sites: [b], reason: 'Bridge fractured' });
      await refused(c, () => voidIt(c, bridge, 'Wrong patient'), /newest/);
      await refused(c, () => voidIt(c, crown, '  '), /Say why this restoration is being removed/);
      await voidIt(c, crown, 'Entered by mistake');
      expect(await resto(c, crown)).toMatchObject({ voided_reason: 'Entered by mistake' });
      expect((await resto(c, crown)).voided_at).not.toBeNull();
      expect(await resto(c, bridge)).toMatchObject({ ended_on: null, end_kind: null, end_reason: null, ended_by: null });
      expect(await stateOf(c, a)).toBe('restored');
      expect(await stateOf(c, b)).toBe('restored');
      expect(await toothOf(c, s.patient, 34)).toBe('restored');
      await refused(c, () => voidIt(c, crown, 'Again'), /not found/i);
      // Undoing the only final takes the implants back to placed.
      await voidIt(c, bridge, 'Entered by mistake');
      expect(await stateOf(c, a)).toBe('placed');
      expect(await toothOf(c, s.patient, 36)).toBe('implant_placed');
    });
  });

  it('refuses an undo that would leave an implant with two current restorations', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const a = await s.placeAt(34);
      const b = await s.placeAt(36);
      await add(c, s.patient, { type: 'bridge', sites: [a, b], teeth: [34, 35, 36], fittedOn: await daysAgo(c, 30) });
      const crown36 = await add(c, s.patient, { sites: [b], reason: 'Bridge fractured', fittedOn: await daysAgo(c, 20) });
      await add(c, s.patient, { sites: [a] }); // 34 had no current restoration
      await refused(c, () => voidIt(c, crown36, 'Mistake'), /newest/);
    });
  });

  it('refuses a date before placement or in the future, and one before the restoration it replaces', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await s.placeAt(36);
      const [d61, tomorrow, d20] = [await daysAgo(c, 61), await daysAgo(c, -1), await daysAgo(c, 20)];
      await refused(c, () => add(c, s.patient, { sites: [site], fittedOn: d61 }), /date fitted/i);
      await refused(c, () => add(c, s.patient, { sites: [site], fittedOn: tomorrow }), /date fitted/i);
      // Fitted on the placement day is immediate loading, and allowed.
      const temp = await add(c, s.patient, { stage: 'temporary', sites: [site], fittedOn: s.placedOn });
      await add(c, s.patient, { stage: 'temporary', sites: [site], fittedOn: await daysAgo(c, 10) });
      await refused(c, () => add(c, s.patient, { sites: [site], fittedOn: d20 }), /before/i);
      expect((await resto(c, temp)).ended_on).toBe(await daysAgo(c, 10));
    });
  });

  it('refuses a removed or failed implant, or one of another patient', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const failed = await s.placeAt(36);
      const removed = await s.placeAt(46);
      const planned = (await c.query('select public.plan_implant($1, 11::smallint) as id', [s.patient])).rows[0].id as string;
      await asPostgres(c);
      await c.query(`update public.implant_sites set state = 'failed' where id = $1`, [failed]);
      await c.query(`update public.implant_sites set state = 'removed' where id = $1`, [removed]);
      await actAs(c, users.organizer);
      await refused(c, () => add(c, s.patient, { sites: [failed] }), /placed implants/i);
      await refused(c, () => add(c, s.patient, { sites: [removed] }), /placed implants/i);
      await refused(c, () => add(c, s.patient, { sites: [planned] }), /placed implants/i);
      const other = await setup(c, 'Zz Resto Other');
      const otherSite = await other.placeAt(36);
      await refused(c, () => add(c, s.patient, { sites: [otherSite] }), /placed implants/i);
    });
  });

  it('needs Edit on Patients', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await s.placeAt(36);
      const id = await add(c, s.patient, { sites: [site] });
      const before = (await resto(c, id)).updated_at;
      await actAs(c, users.viewer);
      await refused(c, () => add(c, s.patient, { sites: [site], reason: 'x' }), /permission to edit Patients/);
      await refused(c, () => c.query(
        `select public.update_restoration($1, null, null, null, null, null, '', $2::timestamptz)`, [id, before]),
        /permission to edit Patients/);
      await refused(c, () => voidIt(c, id, 'x'), /permission to edit Patients/);
      await refused(c, () => c.query(`update public.restorations set notes = 'x' where id = $1`, [id]), /permission denied/);
      // View on Patients reads them.
      expect((await c.query('select id from public.restorations where id = $1', [id])).rows).toHaveLength(1);
      expect((await c.query('select site_id from public.restoration_sites where restoration_id = $1', [id])).rows).toHaveLength(1);
    });
  });
});

describe('update_restoration', () => {
  it('edits details and rejects a stale updated_at', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await s.placeAt(36);
      const id = await add(c, s.patient, { sites: [site], material: 'zirconia' });
      const update = (expected: string, material: string | null = 'lithium_disilicate') =>
        c.query(
          `select public.update_restoration(p_restoration => $1, p_retention => $2, p_material => $3, p_delegate => $4,
             p_supervisor => $5, p_course => null, p_notes => $6, p_expected_updated_at => $7::timestamptz)`,
          [id, 'cement', material, s.delegate, users.organizer, ' Shade A2 ', expected],
        );
      await refused(c, () => update('2026-01-01T00:00:00Z'), /changed by someone else/);
      const current = (await resto(c, id)).updated_at;
      await refused(c, () => update(current, 'gold'), /material/i);
      await update((await resto(c, id)).updated_at);
      expect(await resto(c, id)).toMatchObject({
        retention: 'cement', material: 'lithium_disilicate', delegate_id: s.delegate, supervisor_id: users.organizer,
        notes: 'Shade A2', stage: 'final', type: 'single_crown', teeth: [36],
      });
    });
  });
});

describe('app_private.teeth_contiguous', () => {
  it('accepts one run in arch order', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const check = async (t: number[] | null) =>
        (await c.query('select app_private.teeth_contiguous($1::smallint[]) as ok', [t])).rows[0].ok as boolean;
      expect(await check([36])).toBe(true);
      expect(await check([34, 35, 36])).toBe(true);
      expect(await check([12, 11, 21, 22])).toBe(true);
      expect(await check([41, 31])).toBe(true);
      expect(await check([34, 36])).toBe(false);
      expect(await check([11, 31])).toBe(false);
      expect(await check([34, 34])).toBe(false);
      expect(await check([19])).toBe(false);
      expect(await check([])).toBe(false);
      expect(await check(null)).toBe(false);
    });
  });
});

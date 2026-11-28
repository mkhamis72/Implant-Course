import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { makeDelegate, makePatient, makeProduct, place, receive, setPerms } from './fixtures';

const users = inject('testUsers');

// Removing an implant entered by mistake (0099): the placement and everything recorded on it are deleted, and its
// stock movements with it, so every batch is back where it was before the placement.
async function world(c: Client) {
  await actAs(c, users.organizer);
  const delegate = await makeDelegate(c, 'Zz Remove Delegate');
  const patient = await makePatient(c, 'Zz Remove Patient');
  const implant = await makeProduct(c);
  const lot = await receive(c, implant, 5, 'ZZRM-1');
  const lot2 = await receive(c, implant, 5, 'ZZRM-2');
  const cover = await makeProduct(c, 'cover_screw');
  const coverLot = await receive(c, cover, 3, 'ZZRM-CS');
  const site = await place(c, { patient, tooth: 36, product: implant, lot, delegate, supervisor: users.organizer });
  return { delegate, patient, implant, lot, lot2, cover, coverLot, site };
}

async function onHand(c: Client, lot: string): Promise<number> {
  await asPostgres(c);
  const n = Number((await c.query('select coalesce(sum(delta), 0) as n from public.stock_movements where stock_lot_id = $1', [lot])).rows[0].n);
  await actAs(c, users.organizer);
  return n;
}

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

const remove = (c: Client, site: string, reason = 'Wrong tooth chosen') =>
  c.query('select public.remove_placement(p_site => $1, p_reason => $2)', [site, reason]);

describe('removing an implant entered by mistake', () => {
  it('returns the implant and its components to stock, deletes what was recorded on it and frees the tooth', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.query(
        `select public.fit_component_v4(p_site => $1, p_type => 'cover_screw', p_fitted_on => current_date,
           p_product => $2, p_lot => $3, p_by_delegate => $4, p_by_organizer => null, p_notes => '', p_course => null, p_torque => null, p_holds_component => null, p_holds_restoration => null, p_screw_size => null)`,
        [w.site, w.cover, w.coverLot, w.delegate],
      );
      // A batch correction leaves a use, its reversal and a new use on another batch.
      await c.query('select public.correct_batch(p_site => $1, p_new_lot => $2, p_reason => $3)', [w.site, w.lot2, 'Other box']);
      expect([await onHand(c, w.lot), await onHand(c, w.lot2), await onHand(c, w.coverLot)]).toEqual([5, 4, 2]);

      await remove(c, w.site);

      expect([await onHand(c, w.lot), await onHand(c, w.lot2), await onHand(c, w.coverLot)]).toEqual([5, 5, 3]);
      await asPostgres(c);
      expect((await c.query('select count(*)::int as n from public.implant_sites where id = $1', [w.site])).rows[0].n).toBe(0);
      expect((await c.query('select count(*)::int as n from public.site_components where site_id = $1', [w.site])).rows[0].n).toBe(0);
      expect((await c.query('select count(*)::int as n from public.stock_movements where implant_site_id = $1', [w.site])).rows[0].n).toBe(0);
      expect((await c.query('select status from public.tooth_status where patient_id = $1 and tooth = 36', [w.patient])).rows[0].status).toBe('missing');
      // The deletion's audit row keeps who, when, why and what.
      const audit = (await c.query(
        `select user_id, before from public.audit_log where table_name = 'implant_sites' and action = 'DELETE' and row_id = $1`,
        [w.site],
      )).rows[0];
      expect(audit.user_id).toBe(users.organizer);
      expect(audit.before).toMatchObject({ tooth: 36, stock_lot_id: w.lot2, removal_reason: 'Wrong tooth chosen' });
    });
  });

  it('lets the same tooth be placed again, taking stock again', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await remove(c, w.site);
      await place(c, { patient: w.patient, tooth: 36, product: w.implant, lot: w.lot, delegate: w.delegate, supervisor: users.organizer });
      expect(await onHand(c, w.lot)).toBe(4);
    });
  });

  it('needs a reason, an implant that was placed, and Edit on Patients', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await refused(c, () => remove(c, w.site, ' '), /at least 3 characters/);
      const planned = (await c.query('select public.plan_implant(p_patient => $1, p_tooth => 11::smallint) as id', [w.patient])).rows[0].id;
      await refused(c, () => remove(c, planned), /Only a placed implant/);
      await setPerms(c, users.viewer, { patients: 'view' });
      await actAs(c, users.viewer);
      await refused(c, () => remove(c, w.site), /permission|not allowed|Edit/i);
      await actAs(c, users.delegate);
      await refused(c, () => remove(c, w.site), /permission|not allowed|Edit|active/i);
    });
  });

  it('refuses an implant that is part of a restoration still on record', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      const restoration = (await c.query(
        `select public.add_restoration(p_patient => $1, p_stage => 'final', p_type => 'single_crown', p_sites => array[$2::uuid],
           p_teeth => null, p_fitted_on => current_date, p_retention => null, p_material => null, p_delegate => null,
           p_supervisor => null, p_course => null, p_remake_reason => null, p_notes => '') as id`,
        [w.patient, w.site],
      )).rows[0].id;
      await refused(c, () => remove(c, w.site), /restoration/i);
      // Once the restoration is undone, the implant can go.
      await c.query('select public.void_restoration($1, $2)', [restoration, 'Wrong patient']);
      await remove(c, w.site);
    });
  });

  it('leaves the ledger closed to anything else', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await asPostgres(c);
      await refused(c, () => c.query('delete from public.stock_movements where implant_site_id = $1', [w.site]), /append-only/);
      await refused(c, () => c.query('update public.stock_movements set delta = delta where implant_site_id = $1', [w.site]), /append-only/);
      await actAs(c, users.organizer);
      await refused(c, () => c.query('delete from public.stock_movements where implant_site_id = $1', [w.site]), /permission denied/);
    });
  });
});

describe('deleting a duplicate patient with implants', () => {
  it('deletes the patient with their implants and components and returns the stock', async () => {
    await withTx(async (c) => {
      const w = await world(c);
      await c.query(
        `select public.fit_component_v4(p_site => $1, p_type => 'cover_screw', p_fitted_on => current_date,
           p_product => $2, p_lot => $3, p_by_delegate => $4, p_by_organizer => null, p_notes => '', p_course => null, p_torque => null, p_holds_component => null, p_holds_restoration => null, p_screw_size => null)`,
        [w.site, w.cover, w.coverLot, w.delegate],
      );
      expect([await onHand(c, w.lot), await onHand(c, w.coverLot)]).toEqual([4, 2]);

      await c.query('select public.delete_patient($1)', [w.patient]);

      expect([await onHand(c, w.lot), await onHand(c, w.coverLot)]).toEqual([5, 3]);
      await asPostgres(c);
      expect((await c.query('select count(*)::int as n from public.patients where id = $1', [w.patient])).rows[0].n).toBe(0);
      expect((await c.query('select count(*)::int as n from public.stock_movements where patient_id = $1', [w.patient])).rows[0].n).toBe(0);
    });
  });
});

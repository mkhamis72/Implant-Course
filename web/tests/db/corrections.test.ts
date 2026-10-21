import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { makeDelegate, makePatient, makeProduct, onHand, place, receive } from './fixtures';

const users = inject('testUsers');

async function placed(c: Client) {
  await actAs(c, users.organizer);
  const patient = await makePatient(c);
  const implant = await makeProduct(c);
  const wrongLot = await receive(c, implant, 2, 'WRONG');
  const rightLot = await receive(c, implant, 2, 'RIGHT');
  const delegate = await makeDelegate(c);
  const site = await place(c, { patient, tooth: 36, product: implant, lot: wrongLot, delegate, supervisor: users.organizer });
  return { patient, implant, wrongLot, rightLot, delegate, site };
}

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

describe('correcting the batch used', () => {
  it('moves the unit back to the old batch and takes it from the right one; recall follows', async () => {
    await withTx(async (c) => {
      const s = await placed(c);
      await c.query("select public.correct_batch($1, $2, 'Wrong sticker scanned')", [s.site, s.rightLot]);
      expect(await onHand(c, s.wrongLot)).toBe(2);
      expect(await onHand(c, s.rightLot)).toBe(1);
      expect((await c.query('select stock_lot_id from public.implant_sites where id = $1', [s.site])).rows[0].stock_lot_id).toBe(s.rightLot);
      expect((await c.query('select * from public.lot_usage($1)', [s.wrongLot])).rows).toHaveLength(0);
      expect((await c.query('select * from public.lot_usage($1)', [s.rightLot])).rows).toHaveLength(1);
      const rev = await c.query(
        "select delta, note, reverses_movement_id is not null as reverses from public.stock_movements where stock_lot_id = $1 and reason = 'adjust'",
        [s.wrongLot],
      );
      expect(rev.rows).toEqual([{ delta: 1, note: 'Correction: Wrong sticker scanned', reverses: true }]);
    });
  });

  it('can be corrected twice, and refuses bad targets or no reason', async () => {
    await withTx(async (c) => {
      const s = await placed(c);
      const expired = await receive(c, s.implant, 1, 'OLD', '2020-01-01');
      await refused(c, () => c.query("select public.correct_batch($1, $2, 'x')", [s.site, s.rightLot]), /Explain the correction/);
      await refused(c, () => c.query("select public.correct_batch($1, $2, 'Wrong one')", [s.site, s.wrongLot]), /Choose a different batch/);
      await refused(c, () => c.query("select public.correct_batch($1, $2, 'Wrong one')", [s.site, expired]), /expired on 2020-01-01/);
      await c.query("select public.correct_batch($1, $2, 'First fix')", [s.site, s.rightLot]);
      await c.query("select public.correct_batch($1, $2, 'Back again')", [s.site, s.wrongLot]);
      expect(await onHand(c, s.wrongLot)).toBe(1);
      expect(await onHand(c, s.rightLot)).toBe(2);
    });
  });

  it('corrects a component batch too', async () => {
    await withTx(async (c) => {
      const s = await placed(c);
      const ha = await makeProduct(c, 'healing_abutment');
      const haWrong = await receive(c, ha, 1, 'HA-W');
      const haRight = await receive(c, ha, 1, 'HA-R');
      const comp = (
        await c.query(
          "select public.fit_component(p_site => $1, p_type => 'healing_abutment', p_fitted_on => current_date, p_product => $2, p_lot => $3, p_by_delegate => $4) as id",
          [s.site, ha, haWrong, s.delegate],
        )
      ).rows[0].id;
      await c.query("select public.correct_batch($1, $2, 'Wrong HA batch', $3)", [s.site, haRight, comp]);
      expect(await onHand(c, haWrong)).toBe(1);
      expect(await onHand(c, haRight)).toBe(0);
    });
  });
});

const failedVisit = `select public.record_visit($1, public.cairo_today(), null, '3-month', 'attended', 'failed',
  '{"failure_type":"lost","failure_reason":"no_osseointegration"}'::jsonb, '') as id`;

describe('voiding follow-ups', () => {
  it('voiding the failure restores the implant and tooth', async () => {
    await withTx(async (c) => {
      const s = await placed(c);
      const f = (await c.query(failedVisit, [s.site])).rows[0].id;
      await c.query("select public.void_followup($1, 'Wrong patient clicked')", [f]);
      expect((await c.query('select state from public.implant_sites where id = $1', [s.site])).rows[0].state).toBe('placed');
      const tooth = await c.query('select status from public.tooth_status where patient_id = $1 and tooth = 36', [s.patient]);
      expect(tooth.rows[0].status).toBe('implant_placed');
      const v = await c.query('select voided_reason, voided_by from public.implant_followups where id = $1', [f]);
      expect(v.rows[0]).toEqual({ voided_reason: 'Wrong patient clicked', voided_by: users.organizer });
    });
  });

  it('refuses to undo a failure once the tooth was re-planned', async () => {
    await withTx(async (c) => {
      const s = await placed(c);
      const f = (await c.query(failedVisit, [s.site])).rows[0].id;
      await c.query('select public.plan_implant($1, 36::smallint)', [s.patient]);
      await refused(c, () => c.query("select public.void_followup($1, 'Oops oops')", [f]), /new implant is already recorded/);
    });
  });
});

describe('undoing a component', () => {
  it('returns stock, makes the previous component current, and undoing a crown restores "placed"', async () => {
    await withTx(async (c) => {
      const s = await placed(c);
      const ha = await makeProduct(c, 'healing_abutment');
      const haLot = await receive(c, ha, 1, 'HA');
      const fit = async (type: string, product: string | null, lot: string | null) =>
        (
          await c.query(
            'select public.fit_component(p_site => $1, p_type => $2, p_fitted_on => current_date, p_product => $3, p_lot => $4, p_by_delegate => $5) as id',
            [s.site, type, product, lot, s.delegate],
          )
        ).rows[0].id as string;
      const haId = await fit('healing_abutment', ha, haLot);
      const crown = await fit('final_restoration', null, null);
      await refused(c, () => c.query("select public.void_component($1, 'Not current')", [haId]), /Only the current component/);
      await c.query("select public.void_component($1, 'Crown not fitted yet')", [crown]);
      const site = await c.query('select state from public.implant_sites where id = $1', [s.site]);
      expect(site.rows[0].state).toBe('placed');
      const current = await c.query('select id from public.site_components where site_id = $1 and removed_on is null', [s.site]);
      expect(current.rows).toEqual([{ id: haId }]);
      await c.query("select public.void_component($1, 'HA was never fitted')", [haId]);
      expect(await onHand(c, haLot)).toBe(1);
    });
  });
});

describe('correcting the placement details', () => {
  const correct = (c: Client, site: string, f: Record<string, unknown>) =>
    c.query(
      `select public.correct_placement(p_site => $1, p_placed_on => $2::date, p_placing_delegate => $3,
         p_assisting_delegate => $4, p_supervisor => $5, p_torque => $6, p_isq => $7, p_bone_type => $8,
         p_graft => $9, p_notes => $10)`,
      [site, f.placedOn, f.placing, f.assisting ?? null, f.supervisor, f.torque ?? null, f.isq ?? null, f.boneType ?? null,
       f.graft ?? '', f.notes ?? ''],
    );

  it('corrects the date and people (stability values are ignored), leaving stock alone', async () => {
    await withTx(async (c) => {
      const s = await placed(c);
      const right = await makeDelegate(c, 'Zz Right Delegate');
      const helper = await makeDelegate(c, 'Zz Helper');
      await asPostgres(c);
      const sup = (await c.query("insert into public.supervisors (full_name) values ('Zz Prof') returning id")).rows[0].id;
      await actAs(c, users.organizer);
      const before = await onHand(c, s.wrongLot);
      await correct(c, s.site, {
        placedOn: '2026-01-15', placing: right, assisting: helper, supervisor: sup, torque: 40, isq: 70, boneType: 'D3', graft: 'Bio-Oss', notes: 'fixed',
      });
      const { rows } = await c.query(
        `select placed_on::text, placing_delegate_id, assisting_delegate_id, supervisor_id, torque_ncm::float as torque,
                isq::float as isq, bone_type, graft, notes from public.implant_sites where id = $1`,
        [s.site],
      );
      expect(rows[0]).toEqual({
        placed_on: '2026-01-15', placing_delegate_id: right, assisting_delegate_id: helper, supervisor_id: sup,
        torque: null, isq: null, bone_type: null, graft: 'Bio-Oss', notes: 'fixed',
      });
      expect(await onHand(c, s.wrongLot)).toBe(before);
    });
  });

  it('refuses a future date, a date after a follow-up, and a date past the batch expiry', async () => {
    await withTx(async (c) => {
      const s = await placed(c);
      const base = { placing: s.delegate, supervisor: users.organizer };
      await refused(c, () => correct(c, s.site, { ...base, placedOn: '2999-01-01' }), /today or earlier/);
      await correct(c, s.site, { ...base, placedOn: '2026-01-10' });
      await c.query("select public.record_visit($1, '2026-02-01', null, '1-week', 'attended', 'ok', '{}'::jsonb, '')", [s.site]);
      await refused(c, () => correct(c, s.site, { ...base, placedOn: '2026-03-01' }), /after its first component, follow-up, complication or failure/);
      await correct(c, s.site, { ...base, placedOn: '2026-01-20' });

      const expiring = await receive(c, s.implant, 1, 'EXP', '2026-06-01');
      const p2 = await makePatient(c, 'Zz Expiry Patient');
      const site2 = await place(c, { patient: p2, tooth: 11, product: s.implant, lot: expiring, delegate: s.delegate, supervisor: users.organizer, placedOn: '2026-05-01' });
      await refused(c, () => correct(c, site2, { ...base, placedOn: '2026-07-01' }), /expired on 2026-06-01/);
    });
  });

  it('refuses a date after the failure or a complication; allows one before them', async () => {
    await withTx(async (c) => {
      const s = await placed(c);
      const base = { placing: s.delegate, supervisor: users.organizer };
      await correct(c, s.site, { ...base, placedOn: '2026-01-10' });
      await c.query('select public.record_complication($1, $2::jsonb)',
        [s.site, JSON.stringify({ category: 'biological', type: 'mucositis', noticed_on: '2026-03-01' })]);
      await refused(c, () => correct(c, s.site, { ...base, placedOn: '2026-03-02' }), /complication or failure \(2026-03-01\)/);
      await correct(c, s.site, { ...base, placedOn: '2026-03-01' });
      await correct(c, s.site, { ...base, placedOn: '2026-01-10' });
      await c.query("select public.record_failure($1, '2026-02-15', 'lost', 'fracture', '')", [s.site]);
      await refused(c, () => correct(c, s.site, { ...base, placedOn: '2026-02-16' }), /complication or failure \(2026-02-15\)/);
      await correct(c, s.site, { ...base, placedOn: '2026-02-15' });
    });
  });

  it('refuses the same assisting delegate, a new inactive delegate and a planned implant; keeps an inactive one already recorded', async () => {
    await withTx(async (c) => {
      const s = await placed(c);
      const base = { placedOn: '2026-01-10', supervisor: users.organizer };
      await refused(c, () => correct(c, s.site, { ...base, placing: s.delegate, assisting: s.delegate }), /someone other than the placing delegate/);
      const gone = await makeDelegate(c, 'Zz Gone');
      await c.query('update public.delegates set active = false where id = any($1)', [[gone, s.delegate]]);
      await refused(c, () => correct(c, s.site, { ...base, placing: gone }), /Choose the delegate who placed the implant/);
      await correct(c, s.site, { ...base, placing: s.delegate }); // still recorded, so still allowed

      const p2 = await makePatient(c, 'Zz Planned Patient');
      const planned = (await c.query('select public.plan_implant($1, 21::smallint) as id', [p2])).rows[0].id;
      await refused(c, () => correct(c, planned, { ...base, placing: s.delegate }), /Only a placed implant/);
    });
  });

  it('needs Edit on Patients', async () => {
    await withTx(async (c) => {
      const s = await placed(c);
      await actAs(c, users.viewer);
      await refused(c, () => correct(c, s.site, { placedOn: '2026-01-10', placing: s.delegate, supervisor: users.organizer }), /permission to edit Patients/);
    });
  });
});

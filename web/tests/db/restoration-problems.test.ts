import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { makeCourse, makeDelegate, makePatient, makeProduct, place, receive } from './fixtures';

const users = inject('testUsers');

// Kept local: importing another test file would register its tests here too.
async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

const daysAgo = async (c: Client, n: number) =>
  (await c.query('select (public.cairo_today() - $1::int)::text as d', [n])).rows[0].d as string;

async function setup(c: Client, name = 'Zz Problem Patient') {
  await actAs(c, users.organizer);
  const implant = await makeProduct(c);
  const lot = await receive(c, implant, 10, 'RPB');
  const delegate = await makeDelegate(c, 'Zz Problem Delegate');
  const patient = await makePatient(c, name);
  const placedOn = await daysAgo(c, 60);
  const placeAt = (tooth: number) =>
    place(c, { patient, tooth, product: implant, lot, delegate, supervisor: users.organizer, placedOn });
  return { patient, delegate, placedOn, placeAt, implant, lot };
}

const addCrown = async (c: Client, patient: string, site: string, fittedOn: string,
  o: { stage?: string; delegate?: string | null; course?: string | null; reason?: string | null } = {}) =>
  (await c.query(
    `select public.add_restoration(p_patient => $1, p_stage => $2, p_type => 'single_crown', p_sites => array[$3::uuid],
       p_teeth => null, p_fitted_on => $4::date, p_retention => null, p_material => null, p_delegate => $5,
       p_supervisor => null, p_course => $6, p_remake_reason => $7, p_notes => '') as id`,
    [patient, o.stage ?? 'final', site, fittedOn, o.delegate ?? null, o.course ?? null, o.reason ?? null],
  )).rows[0].id as string;

const record = async (c: Client, restoration: string, on: string | null, type: string | null, action: string | null, notes = '') =>
  (await c.query('select public.record_restoration_problem($1, $2::date, $3, $4, $5) as id',
    [restoration, on, type, action, notes])).rows[0].id as string;

const problem = async (c: Client, id: string) =>
  (await c.query(
    `select restoration_id, noticed_on::text, type, action, notes, voided_at, voided_reason, updated_at::text as updated_at
     from public.restoration_problems where id = $1`, [id])).rows[0];

describe('restoration problems', () => {
  it('records, updates and voids a problem', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await s.placeAt(36);
      const r = await addCrown(c, s.patient, site, await daysAgo(c, 20));
      const on = await daysAgo(c, 5);
      const id = await record(c, r, on, 'debonding', 'recemented', '  Came off eating  ');
      expect(await problem(c, id)).toMatchObject({ restoration_id: r, noticed_on: on, type: 'debonding', action: 'recemented', notes: 'Came off eating', voided_at: null });

      const before = (await problem(c, id)).updated_at;
      const on2 = await daysAgo(c, 4);
      await c.query('select public.update_restoration_problem($1, $2::date, $3, $4, $5, $6::timestamptz)',
        [id, on2, 'chipping', 'repaired', 'Polished', before]);
      expect(await problem(c, id)).toMatchObject({ noticed_on: on2, type: 'chipping', action: 'repaired', notes: 'Polished' });

      await refused(c, () => c.query('select public.void_restoration_problem($1, $2)', [id, ' ']), /why/i);
      await c.query('select public.void_restoration_problem($1, $2)', [id, 'Wrong patient']);
      const p = await problem(c, id);
      expect(p.voided_at).not.toBeNull();
      expect(p.voided_reason).toBe('Wrong patient');
      await refused(c, () => c.query('select public.void_restoration_problem($1, $2)', [id, 'Again']), /not found/);
      // The restoration's state is untouched by its problems.
      expect((await c.query('select state from public.implant_sites where id = $1', [site])).rows[0].state).toBe('restored');
    });
  });

  it('refuses a missing or unknown type or action', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const r = await addCrown(c, s.patient, await s.placeAt(36), await daysAgo(c, 20));
      const on = await daysAgo(c, 1);
      await refused(c, () => record(c, r, on, null, 'none'), /problem type/);
      await refused(c, () => record(c, r, on, 'crack', 'none'), /problem type/);
      await refused(c, () => record(c, r, on, 'wear', 'glued'), /action/);
      await refused(c, () => record(c, r, on, 'wear', null), /action/);
      await refused(c, () => record(c, r, on, 'wear', 'none', 'x'.repeat(1001)), /1000/);
    });
  });

  it('keeps the date between the fitting date and the end or today', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await s.placeAt(36);
      const temp = await addCrown(c, s.patient, site, await daysAgo(c, 30), { stage: 'temporary' });
      await refused(c, async () => record(c, temp, await daysAgo(c, 31), 'wear', 'none'), /must be between the fitting date and/);
      await refused(c, async () => record(c, temp, await daysAgo(c, -1), 'wear', 'none'), /must be between the fitting date and today/);
      await refused(c, async () => record(c, temp, null, 'wear', 'none'), /must be between the fitting date and today/);
      await record(c, temp, await daysAgo(c, 30), 'wear', 'none');
      // Ended by the final 10 days ago: after that date is refused.
      await addCrown(c, s.patient, site, await daysAgo(c, 10));
      await record(c, temp, await daysAgo(c, 10), 'fracture', 'none');
      await refused(c, async () => record(c, temp, await daysAgo(c, 9), 'wear', 'none'),
        /must be between the fitting date and the date it ended/);
      // Updates are held to the same range.
      const id = await record(c, temp, await daysAgo(c, 20), 'wear', 'none');
      const before = (await problem(c, id)).updated_at;
      await refused(c, async () => c.query('select public.update_restoration_problem($1, $2::date, $3, $4, $5, $6::timestamptz)',
        [id, await daysAgo(c, 5), 'wear', 'none', '', before]), /must be between the fitting date/);
    });
  });

  it('refuses a stale update', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const r = await addCrown(c, s.patient, await s.placeAt(36), await daysAgo(c, 20));
      const id = await record(c, r, await daysAgo(c, 2), 'wear', 'none');
      await refused(c, () => c.query('select public.update_restoration_problem($1, $2::date, $3, $4, $5, $6::timestamptz)',
        [id, null, 'wear', 'none', '', '2000-01-01T00:00:00Z']), /changed by someone else/);
    });
  });

  it('refuses a voided restoration', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const r = await addCrown(c, s.patient, await s.placeAt(36), await daysAgo(c, 20));
      const id = await record(c, r, await daysAgo(c, 2), 'wear', 'none');
      const before = (await problem(c, id)).updated_at;
      await c.query('select public.void_restoration($1, $2)', [r, 'Wrong tooth']);
      await refused(c, async () => record(c, r, await daysAgo(c, 2), 'wear', 'none'), /removed from the record/);
      await refused(c, async () => c.query('select public.update_restoration_problem($1, $2::date, $3, $4, $5, $6::timestamptz)',
        [id, await daysAgo(c, 2), 'wear', 'none', '', before]), /removed from the record/);
    });
  });

  it('needs Edit on Patients; View on Patients reads them', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const r = await addCrown(c, s.patient, await s.placeAt(36), await daysAgo(c, 20));
      const on = await daysAgo(c, 2);
      const id = await record(c, r, on, 'wear', 'none');
      const before = (await problem(c, id)).updated_at;
      await actAs(c, users.viewer);
      await refused(c, () => record(c, r, on, 'wear', 'none'), /permission to edit Patients/);
      await refused(c, () => c.query('select public.update_restoration_problem($1, $2::date, $3, $4, $5, $6::timestamptz)',
        [id, on, 'wear', 'none', '', before]), /permission to edit Patients/);
      await refused(c, () => c.query('select public.void_restoration_problem($1, $2)', [id, 'x']), /permission to edit Patients/);
      await refused(c, () => c.query(`update public.restoration_problems set notes = 'x' where id = $1`, [id]), /permission denied/);
      expect((await c.query('select id from public.restoration_problems where id = $1', [id])).rows).toHaveLength(1);
      // The History tab shows it.
      const h = await c.query(`select 1 from public.patient_history($1) where table_name = 'restoration_problems'`, [s.patient]);
      expect(h.rows).toHaveLength(1);
    });
  });
});

describe('deleting records that restorations depend on', () => {
  it('delete_patient removes a patient with restorations and problems together with their implants', async () => {
    await withTx(async (c) => {
      const s = await setup(c, 'Zz Problem Delete Patient');
      // A placed implant without stock movements (e.g. corrected ledger) so the patient can be deleted.
      await asPostgres(c);
      const site = (await c.query(
        `insert into public.implant_sites (patient_id, tooth, state, product_id, stock_lot_id, placed_on, placing_delegate_id, supervisor_id)
         values ($1, 36, 'placed', $2, $3, $4::date, $5, $6) returning id`,
        [s.patient, s.implant, s.lot, s.placedOn, s.delegate, users.organizer])).rows[0].id as string;
      await actAs(c, users.organizer);
      const temp = await addCrown(c, s.patient, site, await daysAgo(c, 30), { stage: 'temporary' });
      await record(c, temp, await daysAgo(c, 20), 'wear', 'none');
      await addCrown(c, s.patient, site, await daysAgo(c, 10));
      await c.query('select public.delete_patient($1)', [s.patient]);
      await asPostgres(c);
      expect((await c.query('select count(*)::int as n from public.restorations where patient_id = $1', [s.patient])).rows[0].n).toBe(0);
      expect((await c.query('select count(*)::int as n from public.restoration_problems where restoration_id = $1', [temp])).rows[0].n).toBe(0);
    });
  });

  it('delete_patient still refuses a patient whose implants moved stock', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const r = await addCrown(c, s.patient, await s.placeAt(36), await daysAgo(c, 20));
      await record(c, r, await daysAgo(c, 2), 'wear', 'none');
      await refused(c, () => c.query('select public.delete_patient($1)', [s.patient]), /stock movements .* Archive them instead/);
    });
  });

  it('delete_course refuses a course a restoration is recorded in', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const course = await makeCourse(c);
      const r = await addCrown(c, s.patient, await s.placeAt(36), await daysAgo(c, 20), { course });
      await refused(c, () => c.query('select public.delete_course($1)', [course]), /Restorations were recorded in this course/);
      // Even an undone one keeps its course, so it still refuses rather than clearing it.
      await c.query('select public.void_restoration($1, $2)', [r, 'Wrong course']);
      await refused(c, () => c.query('select public.delete_course($1)', [course]), /Restorations were recorded in this course/);
    });
  });

  it('delete_delegate refuses a delegate who fitted a restoration', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const fitter = await makeDelegate(c, 'Zz Problem Fitter');
      await addCrown(c, s.patient, await s.placeAt(36), await daysAgo(c, 20), { delegate: fitter });
      await refused(c, () => c.query('select public.delete_delegate($1)', [fitter]),
        /This delegate fitted restorations and can't be removed. Set them Inactive instead./);
    });
  });
});

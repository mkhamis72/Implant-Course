import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { makeDelegate, makePatient, makeProduct, place, receive, setPerms } from './fixtures';

const users = inject('testUsers');

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}

const history = async (c: Client, patient: string) =>
  (await c.query(
    `select smoking, cigarettes_per_day, diabetes_status, bisphosphonates_status, anticoagulants_status, radiotherapy_status,
            osteoporosis_status, periodontitis_history, bruxism, previous_implant_failure, hba1c::float as hba1c, hba1c_date::text
     from public.medical_history where patient_id = $1`,
    [patient],
  )).rows[0];

describe('medical history: tri-state risk factors', () => {
  it('a new patient starts with every risk factor not assessed', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const p = await makePatient(c, 'Zz Tristate New');
      expect(await history(c, p)).toEqual({
        smoking: null, cigarettes_per_day: null, diabetes_status: null, bisphosphonates_status: null, anticoagulants_status: null,
        radiotherapy_status: null, osteoporosis_status: null, periodontitis_history: null, bruxism: null,
        previous_implant_failure: null, hba1c: null, hba1c_date: null,
      });
    });
  });

  it('an organizer with Edit on Patients saves the new columns', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const p = await makePatient(c, 'Zz Tristate Save');
      await c.query(
        `update public.medical_history set smoking = 'current', cigarettes_per_day = 10, diabetes_status = 'yes',
           hba1c = 7.2, hba1c_date = '2026-01-10', bruxism = 'no' where patient_id = $1`,
        [p],
      );
      expect(await history(c, p)).toMatchObject({
        smoking: 'current', cigarettes_per_day: 10, diabetes_status: 'yes', hba1c: 7.2, hba1c_date: '2026-01-10', bruxism: 'no',
      });
    });
  });

  it('refuses unknown values, cigarettes without current smoking, an HbA1c without its date, and a future HbA1c date', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const p = await makePatient(c, 'Zz Tristate Checks');
      const set = (sql: string) => c.query(`update public.medical_history set ${sql} where patient_id = $1`, [p]);
      await refused(c, () => set(`diabetes_status = 'maybe'`), /check/);
      await refused(c, () => set(`smoking = 'sometimes'`), /check/);
      await refused(c, () => set(`smoking = 'former', cigarettes_per_day = 5`), /check/);
      await refused(c, () => set(`smoking = 'current', cigarettes_per_day = 0`), /check/);
      await refused(c, () => set(`hba1c = 6.5`), /check/);
      await refused(c, () => set(`hba1c_date = '2026-01-10'`), /check/);
      await refused(c, () => set(`hba1c = 3.9, hba1c_date = '2026-01-10'`), /check/);
      await refused(c, () => set(`hba1c = 6.5, hba1c_date = '2999-01-01'`), /HbA1c date/);
    });
  });

  it('a viewer (View on Patients) and a delegate cannot change the new columns', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const p = await makePatient(c, 'Zz Tristate Viewer');
      await actAs(c, users.viewer);
      const viewer = await c.query(`update public.medical_history set bruxism = 'yes' where patient_id = $1`, [p]);
      expect(viewer.rowCount).toBe(0);
      await actAs(c, users.delegate);
      const delegate = await c.query(`update public.medical_history set bruxism = 'yes' where patient_id = $1`, [p]);
      expect(delegate.rowCount).toBe(0);
      await asPostgres(c);
      expect((await history(c, p)).bruxism).toBeNull();
    });
  });

  it('the old booleans and their sync trigger are gone (0050)', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const cols = await c.query(
        `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'medical_history'
           and column_name in ('diabetes', 'smoker', 'bisphosphonates', 'anticoagulants', 'radiotherapy_head_neck', 'osteoporosis')`,
      );
      expect(cols.rows).toEqual([]);
      const sync = await c.query(`select 1 from pg_trigger where tgrelid = 'public.medical_history'::regclass and tgname = 'medical_history_sync'`);
      expect(sync.rows).toEqual([]);
      expect((await c.query(`select to_regprocedure('app_private.medical_history_sync()') as f`)).rows[0].f).toBeNull();
    });
  });

  it('a future HbA1c date is refused on insert too (restoring a dump)', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const p = await makePatient(c, 'Zz Tristate Restore');
      await asPostgres(c);
      await c.query('delete from public.medical_history where patient_id = $1', [p]);
      await refused(
        c,
        () => c.query(`insert into public.medical_history (patient_id, hba1c, hba1c_date) values ($1, 6.5, '2999-01-01')`, [p]),
        /HbA1c date/,
      );
      await c.query(`insert into public.medical_history (patient_id, smoking, hba1c, hba1c_date) values ($1, 'never', 6.5, '2026-01-10')`, [p]);
      expect(await history(c, p)).toMatchObject({ smoking: 'never', hba1c: 6.5, hba1c_date: '2026-01-10' });
    });
  });
});

async function placedSite(c: Client, placedOn = '2026-03-10') {
  await actAs(c, users.organizer);
  const patient = await makePatient(c, 'Zz Surgery Patient');
  const implant = await makeProduct(c);
  const lot = await receive(c, implant, 2, 'SURG');
  const delegate = await makeDelegate(c, 'Zz Surgery Delegate');
  const site = await place(c, { patient, tooth: 46, product: implant, lot, delegate, supervisor: users.organizer, placedOn });
  return { patient, site };
}

type Surgery = Partial<{
  extraction: string | null; timing: string | null; phenotype: string | null; km: number | null; flap: string | null;
  torqueType: string | null; healing: string | null; closure: string | null; grafting: string | null; expected: string | null;
}>;
const saveSurgery = (c: Client, site: string, s: Surgery = {}) =>
  c.query(
    `select public.save_implant_surgery(p_site => $1, p_extraction_date => $2::date, p_placement_timing => $3,
       p_soft_tissue_phenotype => $4, p_keratinized_mucosa_mm => $5, p_flap => $6, p_torque_type => $7, p_healing => $8,
       p_primary_closure => $9, p_grafting_performed => $10, p_expected_updated_at => $11::timestamptz)`,
    [site, s.extraction ?? null, s.timing ?? null, s.phenotype ?? null, s.km ?? null, s.flap ?? null, s.torqueType ?? null,
     s.healing ?? null, s.closure ?? null, s.grafting ?? null, s.expected ?? null],
  );
const surgeryRow = async (c: Client, site: string) =>
  (await c.query(
    `select extraction_date::text, placement_timing, soft_tissue_phenotype, keratinized_mucosa_mm::float as km, flap, torque_type,
            healing, primary_closure, grafting_performed, updated_at::text as updated_at
     from public.implant_surgery where site_id = $1`, // text keeps the microseconds a JS Date would drop
    [site],
  )).rows[0];

type Graft = Partial<{ procedure: string | null; timing: string | null; performedOn: string | null; material: string | null;
  product: string; membrane: string | null; notes: string }>;
const graftArgs = (g: Graft) => [g.procedure === undefined ? 'gbr' : g.procedure, g.timing === undefined ? 'simultaneous' : g.timing,
  g.performedOn ?? null, g.material ?? null, g.product ?? '', g.membrane ?? null, g.notes ?? ''];
const addGraft = async (c: Client, site: string, g: Graft = {}) =>
  (await c.query(
    `select public.add_implant_graft(p_site => $1, p_procedure => $2, p_timing => $3, p_performed_on => $4::date,
       p_material => $5, p_product => $6, p_membrane => $7, p_notes => $8) as id`,
    [site, ...graftArgs(g)],
  )).rows[0].id as string;
const updateGraft = (c: Client, graft: string, g: Graft = {}) =>
  c.query(
    `select public.update_implant_graft(p_graft => $1, p_procedure => $2, p_timing => $3, p_performed_on => $4::date,
       p_material => $5, p_product => $6, p_membrane => $7, p_notes => $8)`,
    [graft, ...graftArgs(g)],
  );

describe('surgical details', () => {
  it('creates the record, then updates it with the version it read', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      await saveSurgery(c, site, {
        extraction: '2025-10-01', timing: 'delayed', phenotype: 'thick', km: 3.5, flap: 'crestal', torqueType: 'peak',
        healing: 'submerged', closure: 'yes', grafting: 'no',
      });
      const first = await surgeryRow(c, site);
      expect(first).toMatchObject({
        extraction_date: '2025-10-01', placement_timing: 'delayed', soft_tissue_phenotype: 'thick', km: 3.5, flap: 'crestal',
        torque_type: 'peak', healing: 'submerged', primary_closure: 'yes', grafting_performed: 'no',
      });
      await saveSurgery(c, site, { timing: 'delayed', flap: 'flapless', expected: first.updated_at });
      expect(await surgeryRow(c, site)).toMatchObject({ flap: 'flapless', extraction_date: null, grafting_performed: null });
    });
  });

  it('refuses a stale version, and a version sent for a record that does not exist yet', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      await refused(c, () => saveSurgery(c, site, { flap: 'crestal', expected: '2026-01-01T00:00:00Z' }), /changed by someone else/);
      await saveSurgery(c, site, { flap: 'crestal' });
      await refused(c, () => saveSurgery(c, site, { flap: 'flapless' }), /changed by someone else/);
      await refused(c, () => saveSurgery(c, site, { flap: 'flapless', expected: '2026-01-01T00:00:00Z' }), /changed by someone else/);
    });
  });

  it('refuses a planned site, an extraction after placement, and an immediate placement on another day', async () => {
    await withTx(async (c) => {
      const { site, patient } = await placedSite(c, '2026-03-10');
      await asPostgres(c);
      const planned = (await c.query(`insert into public.implant_sites (patient_id, tooth, state) values ($1, 11, 'planned') returning id`, [patient])).rows[0].id;
      await actAs(c, users.organizer);
      await refused(c, () => saveSurgery(c, planned, { flap: 'crestal' }), /only be recorded for a placed implant/);
      await refused(c, () => saveSurgery(c, site, { extraction: '2026-03-11' }), /can't be after the placement date \(2026-03-10\)/);
      await refused(c, () => saveSurgery(c, site, { extraction: '2026-03-01', timing: 'immediate' }), /immediate placement is on the extraction day/);
      await saveSurgery(c, site, { extraction: '2026-03-10', timing: 'immediate' });
      // Other timing/day mismatches are only warned about in the form.
      const { site: other } = await placedSite(c, '2026-03-10');
      await saveSurgery(c, other, { extraction: '2026-03-01', timing: 'delayed' });
    });
  });

  it('accepts a failed implant', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      await asPostgres(c);
      await c.query(`update public.implant_sites set state = 'failed' where id = $1`, [site]);
      await actAs(c, users.organizer);
      await saveSurgery(c, site, { healing: 'transmucosal' });
      expect((await surgeryRow(c, site)).healing).toBe('transmucosal');
    });
  });

  it('a placement date corrected before the extraction date blocks re-saving until the extraction date is fixed', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c, '2026-03-10');
      await saveSurgery(c, site, { extraction: '2026-03-05', timing: 'delayed' });
      await c.query(
        `select public.correct_placement(p_site => $1, p_placed_on => '2026-03-01', p_placing_delegate => placing_delegate_id,
           p_assisting_delegate => null, p_supervisor => supervisor_id, p_torque => null, p_isq => null, p_bone_type => null,
           p_graft => '', p_notes => '') from public.implant_sites where id = $1`,
        [site],
      );
      const expected = (await surgeryRow(c, site)).updated_at;
      await refused(c, () => saveSurgery(c, site, { extraction: '2026-03-05', timing: 'delayed', expected }), /\(2026-03-01\)/);
      await saveSurgery(c, site, { extraction: '2026-02-01', timing: 'delayed', expected });
    });
  });
});

describe('grafts', () => {
  it('adds, updates and deletes grafts; a simultaneous graft stores no date', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c, '2026-03-10');
      const id = await addGraft(c, site, { procedure: 'gbr', timing: 'simultaneous', performedOn: '2026-03-01', material: 'xenograft', product: 'Bio-Oss 0.5 g', membrane: 'resorbable' });
      const row = async () => (await c.query('select procedure, timing, performed_on::text, material, product, membrane from public.implant_grafts where id = $1', [id])).rows[0];
      expect(await row()).toEqual({ procedure: 'gbr', timing: 'simultaneous', performed_on: null, material: 'xenograft', product: 'Bio-Oss 0.5 g', membrane: 'resorbable' });
      await updateGraft(c, id, { procedure: 'sinus_lateral', timing: 'staged', performedOn: '2025-12-01', material: 'combination' });
      expect(await row()).toMatchObject({ procedure: 'sinus_lateral', timing: 'staged', performed_on: '2025-12-01', material: 'combination', membrane: null });
      await c.query('select public.delete_implant_graft($1)', [id]);
      expect(await row()).toBeUndefined();
      await refused(c, () => c.query('select public.delete_implant_graft($1)', [id]), /Graft not found/);
    });
  });

  it('a staged graft needs a date before placement; procedure and timing are required', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c, '2026-03-10');
      await refused(c, () => addGraft(c, site, { timing: 'staged' }), /staged graft needs its date, before the placement date \(2026-03-10\)/);
      await refused(c, () => addGraft(c, site, { timing: 'staged', performedOn: '2026-03-10' }), /staged graft needs its date/);
      await refused(c, () => addGraft(c, site, { procedure: null }), /Choose the graft procedure/);
      await refused(c, () => addGraft(c, site, { timing: null }), /Choose simultaneous or staged/);
      await refused(c, () => addGraft(c, site, { procedure: 'magic' }), /check/);
    });
  });

  it('"Grafting performed: no" and grafts exclude each other', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      await addGraft(c, site);
      await refused(c, () => saveSurgery(c, site, { grafting: 'no' }), /Delete them before setting Grafting performed to No/);
      const { site: other } = await placedSite(c);
      await saveSurgery(c, other, { grafting: 'no' });
      await refused(c, () => addGraft(c, other), /Change it to Yes before adding a graft/);
    });
  });

  // A placed site can't be deleted in a test (stock_movements is append-only and references it), so check the FKs.
  it('surgical details and grafts are deleted with their implant site', async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(`
        select conrelid::regclass::text as tbl, confdeltype from pg_constraint
        where contype = 'f' and confrelid = 'public.implant_sites'::regclass
          and conrelid in ('public.implant_surgery'::regclass, 'public.implant_grafts'::regclass) order by 1`);
      expect(rows).toEqual([{ tbl: 'implant_grafts', confdeltype: 'c' }, { tbl: 'implant_surgery', confdeltype: 'c' }]);
    });
  });
});

describe('surgical details: access and history', () => {
  it('needs Edit on Patients to write; View on Patients to read; delegates read nothing', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      await saveSurgery(c, site, { flap: 'crestal' });
      const graft = await addGraft(c, site);
      await actAs(c, users.viewer);
      await refused(c, () => saveSurgery(c, site, { flap: 'flapless' }), /permission to edit Patients/);
      await refused(c, () => addGraft(c, site), /permission to edit Patients/);
      await refused(c, () => c.query('select public.delete_implant_graft($1)', [graft]), /permission to edit Patients/);
      expect((await c.query('select count(*)::int as n from public.implant_surgery where site_id = $1', [site])).rows[0].n).toBe(1);
      await refused(c, () => c.query(`update public.implant_surgery set flap = 'other' where site_id = $1`, [site]), /permission denied/);
      await refused(c, () => c.query(`delete from public.implant_grafts where id = $1`, [graft]), /permission denied/);

      await setPerms(c, users.target, { schedule: 'view' });
      await actAs(c, users.target);
      expect((await c.query('select count(*)::int as n from public.implant_surgery where site_id = $1', [site])).rows[0].n).toBe(0);
      expect((await c.query('select count(*)::int as n from public.implant_grafts where site_id = $1', [site])).rows[0].n).toBe(0);

      await actAs(c, users.delegate);
      expect((await c.query('select count(*)::int as n from public.implant_surgery')).rows[0].n).toBe(0);
      expect((await c.query('select count(*)::int as n from public.implant_grafts')).rows[0].n).toBe(0);
    });
  });

  it('surgery and graft changes appear in the patient History', async () => {
    await withTx(async (c) => {
      const { site, patient } = await placedSite(c);
      await saveSurgery(c, site, { flap: 'crestal' });
      await addGraft(c, site);
      const { rows } = await c.query('select table_name, action from public.patient_history($1)', [patient]);
      expect(rows).toEqual(expect.arrayContaining([
        { table_name: 'implant_surgery', action: 'INSERT' },
        { table_name: 'implant_grafts', action: 'INSERT' },
      ]));
    });
  });
});

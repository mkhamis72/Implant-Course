import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { makeDelegate, makePatient, makeProduct, place, receive, setPerms } from './fixtures';

const users = inject('testUsers');

const daysAgo = async (c: Client, n: number) =>
  (await c.query('select (public.cairo_today() - $1::int)::text as d', [n])).rows[0].d as string;

async function setup(c: Client, name = 'Zz Quality Patient') {
  await actAs(c, users.organizer);
  const implant = await makeProduct(c);
  const lot = await receive(c, implant, 10, 'DQ');
  const delegate = await makeDelegate(c, 'Zz Quality Delegate');
  const patient = await makePatient(c, name);
  const placedOn = await daysAgo(c, 100);
  const site = await place(c, { patient, tooth: 36, product: implant, lot, delegate, supervisor: users.organizer, placedOn });
  await asPostgres(c);
  return { patient, site, placedOn, delegate, implant, lot };
}

const issues = async (c: Client, patient: string | null) =>
  (await c.query(
    `select patient_id, patient_name, file_no, site_id, tooth, kind, record_table, record_id, record_date::text as record_date,
            reference_date::text as reference_date, message
     from public.data_quality_issues($1) order by record_table, record_date`, [patient])).rows;

const visitAt = async (c: Client, site: string, date: string, voided = false) =>
  (await c.query(
    `insert into public.implant_followups (site_id, date, check_type, outcome, attendance, voided_at)
     values ($1, $2::date, 'Review', 'ok', 'attended', ${voided ? 'now()' : 'null'}) returning id`, [site, date])).rows[0].id as string;

const restorationAt = async (c: Client, patient: string, site: string, fittedOn: string) => {
  const id = (await c.query(
    `insert into public.restorations (patient_id, stage, type, teeth, fitted_on)
     values ($1, 'final', 'single_crown', array[36]::smallint[], $2::date) returning id`, [patient, fittedOn])).rows[0].id as string;
  await c.query('insert into public.restoration_sites (restoration_id, site_id) values ($1, $2)', [id, site]);
  return id;
};

const xrayAt = (c: Client, patient: string, takenOn: string, purpose: string) =>
  c.query(
    `insert into public.radiographs (patient_id, taken_on, type, purpose, teeth)
     values ($1, $2::date, 'periapical', $3, array[36]::smallint[]) returning id`, [patient, takenOn, purpose]);

describe('data_quality_issues', () => {
  it('returns nothing for clean data', async () => {
    await withTx(async (c) => {
      const { patient, site, placedOn } = await setup(c);
      await visitAt(c, site, await daysAgo(c, 50));
      await xrayAt(c, patient, placedOn, 'baseline');
      expect(await issues(c, patient)).toEqual([]);
    });
  });

  it('flags a follow-up visit before the placement date, with a full message', async () => {
    await withTx(async (c) => {
      const { patient, site, placedOn } = await setup(c, 'Zz Quality Visit');
      const before = await daysAgo(c, 101);
      const id = await visitAt(c, site, before);
      const rows = await issues(c, patient);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        patient_id: patient, patient_name: 'Zz Quality Visit', site_id: site, tooth: 36, kind: 'before_placement',
        record_table: 'implant_followups', record_id: id, record_date: before, reference_date: placedOn,
        message: `Follow-up visit dated ${before} is before the placement date (${placedOn}).`,
      });
      expect(rows[0].file_no).toMatch(/^P/);
    });
  });

  it('flags a follow-up visit in the future, and ignores voided ones', async () => {
    await withTx(async (c) => {
      const { patient, site } = await setup(c);
      const future = (await c.query(`select (public.cairo_today() + 5)::text as d`)).rows[0].d as string;
      await visitAt(c, site, future);
      await visitAt(c, site, future, true);
      await visitAt(c, site, await daysAgo(c, 101), true);
      const rows = await issues(c, patient);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: 'in_future', record_date: future });
    });
  });

  it('flags a complication before placement and one in the future', async () => {
    await withTx(async (c) => {
      const { patient, site } = await setup(c);
      const future = (await c.query(`select (public.cairo_today() + 3)::text as d`)).rows[0].d as string;
      await c.query(
        `insert into public.implant_complications (site_id, category, type, noticed_on)
         values ($1, 'biological', 'mucositis', $2::date), ($1, 'biological', 'mucositis', $3::date)`,
        [site, await daysAgo(c, 120), future]);
      const rows = await issues(c, patient);
      expect(rows.map((r) => r.kind).sort()).toEqual(['before_placement', 'in_future']);
      expect(rows.every((r) => r.record_table === 'implant_complications')).toBe(true);
    });
  });

  it('flags a restoration fitted before placement or in the future', async () => {
    await withTx(async (c) => {
      const { patient, site } = await setup(c);
      const future = (await c.query(`select (public.cairo_today() + 3)::text as d`)).rows[0].d as string;
      await restorationAt(c, patient, site, await daysAgo(c, 110));
      await restorationAt(c, patient, site, future);
      const rows = await issues(c, patient);
      expect(rows.map((r) => r.kind).sort()).toEqual(['before_placement', 'in_future']);
      expect(rows.every((r) => r.record_table === 'restorations' && r.site_id)).toBe(true);
    });
  });

  it('flags an X-ray before placement but not a planning X-ray', async () => {
    await withTx(async (c) => {
      const { patient, site } = await setup(c);
      const before = await daysAgo(c, 130);
      await xrayAt(c, patient, before, 'planning');
      await xrayAt(c, patient, before, 'follow_up');
      await xrayAt(c, patient, await daysAgo(c, 131), 'baseline');
      const rows = await issues(c, patient);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.record_table === 'radiographs' && r.kind === 'before_placement' && r.site_id === site)).toBe(true);
    });
  });

  it('flags a planning X-ray in the future', async () => {
    await withTx(async (c) => {
      const { patient } = await setup(c);
      const future = (await c.query(`select (public.cairo_today() + 2)::text as d`)).rows[0].d as string;
      await xrayAt(c, patient, future, 'planning');
      const rows = await issues(c, patient);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: 'in_future', record_table: 'radiographs' });
    });
  });

  it('flags a failure date before placement', async () => {
    await withTx(async (c) => {
      const { patient, site } = await setup(c);
      await c.query(`update public.implant_sites set state = 'failed', failed_on = $2::date where id = $1`,
        [site, await daysAgo(c, 105)]);
      const rows = (await issues(c, patient)).filter((r) => r.record_table === 'implant_sites');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: 'before_placement', record_id: site });
    });
  });

  it('flags a restoration problem noticed before the restoration was fitted', async () => {
    await withTx(async (c) => {
      const { patient, site } = await setup(c);
      const rid = await restorationAt(c, patient, site, await daysAgo(c, 50));
      const noticed = await daysAgo(c, 60);
      await c.query(
        `insert into public.restoration_problems (restoration_id, noticed_on, type, action) values ($1, $2::date, 'chipping', 'none')`,
        [rid, noticed]);
      const rows = await issues(c, patient);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: 'problem_before_fitting', record_table: 'restoration_problems', record_date: noticed,
        reference_date: await daysAgo(c, 50), site_id: site, tooth: 36 });
    });
  });

  it('does not flag an X-ray from a first implant against its replacement on the same tooth', async () => {
    await withTx(async (c) => {
      const { patient, site, implant, lot, delegate } = await setup(c);
      const xrayDay = await daysAgo(c, 60);
      await xrayAt(c, patient, xrayDay, 'follow_up');
      await c.query(`update public.implant_sites set state = 'failed', failed_on = $2::date where id = $1`, [site, await daysAgo(c, 40)]);
      await actAs(c, users.organizer);
      await place(c, { patient, tooth: 36, product: implant, lot, delegate, supervisor: users.organizer, placedOn: await daysAgo(c, 20) });
      await asPostgres(c);
      expect(await issues(c, patient)).toEqual([]);
    });
  });

  it('lists a record once even when it covers several implants (earliest-placed site)', async () => {
    await withTx(async (c) => {
      const { patient, site, implant, lot, delegate } = await setup(c);
      await actAs(c, users.organizer);
      const second = await place(c, { patient, tooth: 37, product: implant, lot, delegate, supervisor: users.organizer, placedOn: await daysAgo(c, 90) });
      await asPostgres(c);
      const rid = await restorationAt(c, patient, site, await daysAgo(c, 150));
      await c.query('insert into public.restoration_sites (restoration_id, site_id) values ($1, $2)', [rid, second]);
      await c.query(`update public.restorations set teeth = array[36, 37]::smallint[] where id = $1`, [rid]);
      const rows = (await issues(c, patient)).filter((r) => r.record_table === 'restorations');
      expect(rows).toHaveLength(1);
      expect(rows[0].site_id).toBe(site);
    });
  });

  it('with a null patient returns issues for all patients', async () => {
    await withTx(async (c) => {
      const { site } = await setup(c);
      await visitAt(c, site, await daysAgo(c, 101));
      const rows = await issues(c, null);
      expect(rows.some((r) => r.site_id === site)).toBe(true);
    });
  });

  it('is readable by a viewer with Patients view and empty without it', async () => {
    await withTx(async (c) => {
      const { patient, site } = await setup(c);
      await visitAt(c, site, await daysAgo(c, 101));
      await setPerms(c, users.viewer, { patients: 'view' });
      await actAs(c, users.viewer);
      expect(await issues(c, patient)).toHaveLength(1);
      await setPerms(c, users.viewer, { schedule: 'view', courses: 'view', inventory: 'edit' });
      await actAs(c, users.viewer);
      expect(await issues(c, patient)).toEqual([]);
    });
  });
});

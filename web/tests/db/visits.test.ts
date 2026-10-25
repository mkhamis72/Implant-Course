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

/** A placed implant `daysAgo` days before the Cairo today (default 30). */
export async function placedSite(c: Client, daysAgo = 30, name = 'Zz Visit Patient') {
  await actAs(c, users.organizer);
  const placedOn = (await c.query('select (public.cairo_today() - $1::int)::text as d', [daysAgo])).rows[0].d as string;
  const patient = await makePatient(c, name);
  const implant = await makeProduct(c);
  const lot = await receive(c, implant, 2, 'VIS');
  const delegate = await makeDelegate(c, 'Zz Visit Delegate');
  const site = await place(c, { patient, tooth: 36, product: implant, lot, delegate, supervisor: users.organizer, placedOn });
  return { patient, site, placedOn };
}

type Visit = Partial<{ date: string; key: string | null; check: string; attendance: string | null; outcome: string | null;
  findings: Record<string, unknown>; notes: string }>;
const today = async (c: Client) => (await c.query('select public.cairo_today()::text as d')).rows[0].d as string;
export async function recordVisit(c: Client, site: string, v: Visit = {}) {
  const { rows } = await c.query(
    `select public.record_visit(p_site => $1, p_date => $2::date, p_visit_key => $3, p_check_type => $4,
       p_attendance => $5, p_outcome => $6::public.followup_outcome, p_findings => $7::jsonb, p_notes => $8) as id`,
    [site, v.date ?? (await today(c)), v.key === undefined ? 'early_review' : v.key, v.check ?? '',
     v.attendance === undefined ? 'attended' : v.attendance, v.outcome === undefined ? 'ok' : v.outcome,
     JSON.stringify(v.findings ?? {}), v.notes ?? ''],
  );
  return rows[0].id as string;
}
const row = async (c: Client, id: string) =>
  (await c.query(
    `select visit_key, check_type, attendance, outcome, pain_score, patient_concerns, swelling, mobility,
            probing_mesial::float as pm, probing_buccal::float as pb, recession_facial_mm::float as rf,
            recession_mesial_mm::float as rm, recession_distal_mm::float as rd, bop_buccal, bop_mesial, isq::float as isq,
            prosthesis_status, radiograph_taken, recommended_treatment, notes
     from public.implant_followups where id = $1`, [id])).rows[0];

describe('record_visit', () => {
  it('records an attended scheduled visit with findings; the check name is the schedule label', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      const id = await recordVisit(c, site, {
        findings: { pain_score: 2, patient_concerns: ' tender ', swelling: 'no', mobility: 'no', probing_mesial: 3, probing_buccal: 4.5,
          bop_buccal: 'yes', bop_mesial: 'no', isq: 72, prosthesis_status: 'not_restored', radiograph_taken: 'yes', recommended_treatment: 'OHI' },
      });
      expect(await row(c, id)).toMatchObject({
        visit_key: 'early_review', check_type: 'Early review (suture removal)', attendance: 'attended', outcome: 'ok', pain_score: 2,
        patient_concerns: 'tender', swelling: 'no', mobility: 'no', pm: 3, pb: 4.5, bop_buccal: 'yes', bop_mesial: 'no', isq: 72,
        prosthesis_status: 'not_restored', radiograph_taken: 'yes', recommended_treatment: 'OHI',
      });
    });
  });

  it('records did-not-attend and not-needed visits without outcome or findings; not needed needs a reason', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c, 200);
      const dna = await recordVisit(c, site, { key: 'early_review', attendance: 'did_not_attend', outcome: null });
      expect(await row(c, dna)).toMatchObject({ attendance: 'did_not_attend', outcome: null, pain_score: null, swelling: null });
      await refused(c, () => recordVisit(c, site, { key: 'osseointegration', attendance: 'not_needed', outcome: null }), /Say why the visit was not needed/);
      const nn = await recordVisit(c, site, { key: 'osseointegration', attendance: 'not_needed', outcome: null, notes: 'Seen at private clinic' });
      expect(await row(c, nn)).toMatchObject({ attendance: 'not_needed', notes: 'Seen at private clinic' });
    });
  });

  it('records unscheduled visits with a check name and a year-N label for annual visits', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c, 800);
      const u = await recordVisit(c, site, { key: null, check: 'Pain review' });
      expect((await row(c, u)).check_type).toBe('Pain review');
      await refused(c, () => recordVisit(c, site, { key: null, check: '  ' }), /Enter what the visit was for/);
      const y = await recordVisit(c, site, { key: 'year_2' });
      expect((await row(c, y)).check_type).toBe('Year-2 review');
    });
  });

  it('records recession at three sites; empty means not measured', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      const id = await recordVisit(c, site, { findings: { recession_facial_mm: 1.5, recession_mesial_mm: 0 } });
      expect(await row(c, id)).toMatchObject({ rf: 1.5, rm: 0, rd: null });
    });
  });

  it('refuses bad dates, unknown visits, duplicates, missing attendance or outcome, and findings when not attended', async () => {
    await withTx(async (c) => {
      const { site, placedOn } = await placedSite(c);
      const dayBefore = (await c.query('select ($1::date - 1)::text as d', [placedOn])).rows[0].d;
      await refused(c, () => recordVisit(c, site, { date: dayBefore }), /cannot be before the implant was placed/);
      await refused(c, () => recordVisit(c, site, { date: '2999-01-01' }), /today or earlier/);
      await refused(c, () => recordVisit(c, site, { key: 'month_9' }), /Unknown visit/);
      await refused(c, () => recordVisit(c, site, { attendance: null }), /Choose whether the patient attended/);
      await refused(c, () => recordVisit(c, site, { attendance: 'maybe' }), /Choose whether the patient attended/);
      await refused(c, () => recordVisit(c, site, { outcome: null }), /Choose the outcome/);
      await refused(c, () => recordVisit(c, site, { attendance: 'did_not_attend', outcome: 'ok' }), /outcome is recorded only when the patient attended/);
      await refused(c, () => recordVisit(c, site, { attendance: 'did_not_attend', outcome: null, findings: { pain_score: 3 } }), /Findings are recorded only when the patient attended/);
      await refused(c, () => recordVisit(c, site, { attendance: 'did_not_attend', outcome: null, findings: { recession_facial_mm: 1 } }), /Findings are recorded only when the patient attended/);
      await recordVisit(c, site);
      await refused(c, () => recordVisit(c, site), /Early review \(suture removal\) is already recorded for this implant/);
    });
  });

  it('refuses out-of-range, malformed and unknown findings', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      const bad = (findings: Record<string, unknown>) => recordVisit(c, site, { findings });
      await refused(c, () => bad({ pain_score: 11 }), /Enter a pain score from 0 to 10/);
      await refused(c, () => bad({ pain_score: 2.5 }), /Enter a pain score from 0 to 10/);
      await refused(c, () => bad({ probing_mesial: 'deep' }), /Enter probing depths from 0 to 15 mm/);
      await refused(c, () => bad({ probing_lingual: 16 }), /Enter probing depths from 0 to 15 mm/);
      await refused(c, () => bad({ recession_facial_mm: 16 }), /Enter recession from 0 to 15 mm/);
      await refused(c, () => bad({ recession_distal_mm: -1 }), /Enter recession from 0 to 15 mm/);
      await refused(c, () => bad({ recession_mesial_mm: 'some' }), /Enter recession from 0 to 15 mm/);
      await refused(c, () => bad({ isq: 101 }), /Enter an ISQ from 0 to 100/);
      await refused(c, () => bad({ swelling: 'maybe' }), /Choose swelling from the list/);
      await refused(c, () => bad({ prosthesis_status: 'wobbly' }), /Choose the prosthesis status from the list/);
      await refused(c, () => bad({ colour: 'pink' }), /Unknown finding: colour/);
    });
  });

  it('a voided visit can be recorded again; a failed outcome fails the implant and the tooth', async () => {
    await withTx(async (c) => {
      const { site, patient } = await placedSite(c);
      const first = await recordVisit(c, site);
      await c.query(`select public.void_followup($1, 'Wrong patient')`, [first]);
      await recordVisit(c, site, { outcome: 'failed', findings: { failure_type: 'lost', failure_reason: 'no_osseointegration' } });
      expect((await c.query('select state from public.implant_sites where id = $1', [site])).rows[0].state).toBe('failed');
      expect((await c.query('select status from public.tooth_status where patient_id = $1 and tooth = 36', [patient])).rows[0].status).toBe('failed');
    });
  });

  it('needs Edit on Patients; record_followup is gone (0051)', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      await actAs(c, users.viewer);
      await refused(c, () => recordVisit(c, site), /permission to edit Patients/);
      await asPostgres(c);
      expect((await c.query(`select to_regproc('public.record_followup') as f`)).rows[0].f).toBeNull();
    });
  });

  it('visit_schedule lists the fixed visits and the annual ones up to the given year', async () => {
    await withTx(async (c) => {
      await asPostgres(c);
      const { rows } = await c.query('select visit_key, label, target_day, window_start, window_end from public.visit_schedule(3)');
      expect(rows).toEqual([
        { visit_key: 'early_review', label: 'Early review (suture removal)', target_day: 10, window_start: 7, window_end: 21 },
        { visit_key: 'osseointegration', label: 'Osseointegration check', target_day: 90, window_start: 70, window_end: 112 },
        { visit_key: 'month_6', label: '6-month review', target_day: 182, window_start: 152, window_end: 212 },
        { visit_key: 'month_12', label: '12-month review', target_day: 365, window_start: 305, window_end: 425 },
        { visit_key: 'year_2', label: 'Year-2 review', target_day: 730, window_start: 670, window_end: 790 },
        { visit_key: 'year_3', label: 'Year-3 review', target_day: 1095, window_start: 1035, window_end: 1155 },
      ]);
      expect((await c.query('select count(*)::int as n from public.visit_schedule(1)')).rows[0].n).toBe(4);
    });
  });
});

const visits = async (c: Client, patient: string) =>
  (await c.query('select visit_key, status, followup_id from public.implant_visits($1)', [patient])).rows as
    { visit_key: string; status: string; followup_id: string | null }[];
const statusOf = async (c: Client, patient: string, key: string) => (await visits(c, patient)).find((v) => v.visit_key === key)?.status;

describe('implant_visits', () => {
  it.each([
    [6, 'upcoming'], [7, 'due'], [10, 'due'], [11, 'overdue'], [21, 'overdue'], [22, 'missed'],
  ])('early review %i days after placement is %s', async (days, status) => {
    await withTx(async (c) => {
      const { patient } = await placedSite(c, days);
      expect(await statusOf(c, patient, 'early_review')).toBe(status);
    });
  });

  it('lists the fixed visits for a new implant and annual visits as time passes', async () => {
    await withTx(async (c) => {
      const fresh = await placedSite(c, 0, 'Zz Visit Fresh');
      expect((await visits(c, fresh.patient)).map((v) => v.visit_key)).toEqual(['early_review', 'osseointegration', 'month_6', 'month_12']);
      const old = await placedSite(c, 700, 'Zz Visit Old');
      const keys = (await visits(c, old.patient)).map((v) => v.visit_key);
      expect(keys).toContain('year_2');
      expect(keys).toContain('year_3');
      expect(keys).not.toContain('year_4');
      expect(await statusOf(c, old.patient, 'year_2')).toBe('due'); // window 670–790, target 730
      expect(await statusOf(c, old.patient, 'year_3')).toBe('upcoming');
    });
  });

  it('takes done / did not attend / not needed from the record; a voided record no longer counts', async () => {
    await withTx(async (c) => {
      const { patient, site } = await placedSite(c, 200);
      const done = await recordVisit(c, site, { key: 'early_review' });
      await recordVisit(c, site, { key: 'osseointegration', attendance: 'did_not_attend', outcome: null });
      await recordVisit(c, site, { key: 'month_6', attendance: 'not_needed', outcome: null, notes: 'Moved away' });
      const v = await visits(c, patient);
      expect(v.find((x) => x.visit_key === 'early_review')).toMatchObject({ status: 'done', followup_id: done });
      expect(await statusOf(c, patient, 'osseointegration')).toBe('did_not_attend');
      expect(await statusOf(c, patient, 'month_6')).toBe('not_needed');
      await c.query(`select public.void_followup($1, 'Entered on the wrong tooth')`, [done]);
      expect(await statusOf(c, patient, 'early_review')).toBe('missed');
    });
  });

  it('expects no further visits for a failed implant, but keeps the visits already recorded', async () => {
    await withTx(async (c) => {
      const { patient, site } = await placedSite(c, 200);
      await recordVisit(c, site, { key: 'early_review' });
      await recordVisit(c, site, { key: null, check: 'Mobile implant', outcome: 'failed', findings: { failure_type: 'lost', failure_reason: 'no_osseointegration' } });
      // Failed today (day 200): the osseointegration window closed before the failure, so it stays as missed (0048).
      expect(await visits(c, patient)).toEqual([
        expect.objectContaining({ visit_key: 'early_review', status: 'done' }),
        expect.objectContaining({ visit_key: 'osseointegration', status: 'missed' }),
      ]);
    });
  });

  it('a Schedule-only user and a delegate get no visit statuses', async () => {
    await withTx(async (c) => {
      const { patient } = await placedSite(c, 30);
      await setPerms(c, users.target, { schedule: 'view' });
      await actAs(c, users.target);
      expect(await visits(c, patient)).toEqual([]);
      await actAs(c, users.delegate);
      expect(await visits(c, patient)).toEqual([]);
    });
  });
});

describe('recall_list', () => {
  const recall = async (c: Client, patient: string) =>
    (await c.query('select visit_key, status, phone from public.recall_list() where patient_id = $1', [patient])).rows;

  it('lists due and overdue visits, and visits missed in the last 60 days', async () => {
    await withTx(async (c) => {
      const overdue = await placedSite(c, 11, 'Zz Recall Overdue');
      expect(await recall(c, overdue.patient)).toEqual([{ visit_key: 'early_review', status: 'overdue', phone: '' }]);
      const missedRecently = await placedSite(c, 30, 'Zz Recall Missed');
      expect(await recall(c, missedRecently.patient)).toEqual([{ visit_key: 'early_review', status: 'missed', phone: '' }]);
      const later = await placedSite(c, 200, 'Zz Recall Later');
      // Early review closed 179 days ago and osseointegration 88 days ago (beyond 60); the 6-month review is overdue.
      expect(await recall(c, later.patient)).toEqual([{ visit_key: 'month_6', status: 'overdue', phone: '' }]);
    });
  });

  it('leaves out recorded visits, failed implants and archived patients', async () => {
    await withTx(async (c) => {
      const recorded = await placedSite(c, 11, 'Zz Recall Recorded');
      await recordVisit(c, recorded.site, { key: 'early_review' });
      expect(await recall(c, recorded.patient)).toEqual([]);
      const failed = await placedSite(c, 11, 'Zz Recall Failed');
      await recordVisit(c, failed.site, { key: null, check: 'Lost', outcome: 'failed', findings: { failure_type: 'lost', failure_reason: 'no_osseointegration' } });
      expect(await recall(c, failed.patient)).toEqual([]);
      const archived = await placedSite(c, 11, 'Zz Recall Archived');
      await c.query('update public.patients set archived = true where id = $1', [archived.patient]);
      expect(await recall(c, archived.patient)).toEqual([]);
    });
  });
});

describe('last follow-up in reports', () => {
  it('delegate_report keeps the last real outcome after a did-not-attend visit', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c, 200);
      await recordVisit(c, site, { key: 'early_review', outcome: 'integrated' });
      await recordVisit(c, site, { key: 'osseointegration', attendance: 'did_not_attend', outcome: null });
      const delegate = (await c.query('select placing_delegate_id as d from public.implant_sites where id = $1', [site])).rows[0].d;
      const { rows } = await c.query('select last_outcome from public.delegate_report($1) where site_id = $2', [delegate, site]);
      expect(rows).toEqual([{ last_outcome: 'integrated' }]);
    });
  });
});

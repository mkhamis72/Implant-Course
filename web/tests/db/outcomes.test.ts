import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { enroll, legacyFailure, makeCourse, makeDelegate, makePatient, makeProduct, place, receive, setPerms } from './fixtures';

const users = inject('testUsers');

const daysAgo = async (c: Client, n: number) =>
  (await c.query('select (public.cairo_today() - $1::int)::text as d', [n])).rows[0].d as string;

/** A patient with implants placed `placedAgo` days before the Cairo today; `day(n)` is placement + n days. */
async function setup(c: Client, placedAgo: number, name = 'Zz Outcome Patient') {
  await actAs(c, users.organizer);
  const implant = await makeProduct(c);
  const lot = await receive(c, implant, 10, 'OUT');
  const delegate = await makeDelegate(c, 'Zz Outcome Delegate');
  const patient = await makePatient(c, name);
  const placedOn = await daysAgo(c, placedAgo);
  const day = (n: number) => daysAgo(c, placedAgo - n);
  const placeAt = (tooth: number, course?: string) =>
    place(c, { patient, tooth, product: implant, lot, delegate, supervisor: users.organizer, placedOn, course });
  return { patient, placedOn, day, placeAt, delegate };
}

const fullFindings = { pain_score: 0, mobility: 'no', suppuration: 'no' };

async function visit(c: Client, site: string, date: string, a: {
  attendance?: string; outcome?: string | null; findings?: Record<string, unknown>;
} = {}) {
  const attendance = a.attendance ?? 'attended';
  return (await c.query(
    `select public.record_visit(p_site => $1, p_date => $2::date, p_visit_key => null, p_check_type => 'Review',
       p_attendance => $3, p_outcome => $4::public.followup_outcome, p_findings => $5::jsonb,
       p_notes => $6) as id`,
    [site, date, attendance, a.outcome === undefined ? (attendance === 'attended' ? 'ok' : null) : a.outcome,
     JSON.stringify(a.findings ?? {}), attendance === 'not_needed' ? 'Seen elsewhere' : ''],
  )).rows[0].id as string;
}

async function xray(c: Client, patient: string, tooth: number, site: string, takenOn: string, purpose: string,
  mesial: number | null, distal: number | null = null) {
  await c.query(
    `select public.save_radiograph(p_id => null, p_patient => $1, p_taken_on => $2::date, p_type => 'periapical',
       p_purpose => $3, p_teeth => $4::smallint[], p_link => null, p_notes => null, p_levels => $5::jsonb,
       p_expected_updated_at => null)`,
    [patient, takenOn, purpose, [tooth], JSON.stringify([{ site, mesial_mm: mesial, distal_mm: distal }])],
  );
}

const grades = async (c: Client, patient: string) =>
  (await c.query(
    `select site_id, visit_date::text as visit_date, bone_loss_mm::float as bone_loss_mm, grade, reason
     from public.visit_grades(array[$1::uuid]) order by visit_date`, [patient])).rows;

const outcome = async (c: Client, site: string, course: string | null = null, from: string | null = null, to: string | null = null) =>
  (await c.query(
    `select site_id, patient_id, tooth, course_id, placed_on::text, loaded_on::text, last_contact::text, follow_up_days,
            event, event_on::text, event_time_unknown, at_loading, year_1, year_2, year_3, year_5,
            latest_grade, latest_grade_on::text, latest_grade_reason, ungraded_later, biological_complications, mechanical_complications, version
     from public.implant_outcomes($1, $2::date, $3::date) where site_id = $4`, [course, from, to, site])).rows[0];

const icoi = async (c: Client, failed: boolean, pain: number | null, mobility: string | null, suppuration: string | null,
  boneLoss: number | null, length: number | null, probing: number | null) =>
  (await c.query('select public.icoi_grade($1, $2, $3, $4, $5, $6, $7) as g',
    [failed, pain, mobility, suppuration, boneLoss, length, probing])).rows[0].g as string;

describe('icoi_grade', () => {
  it('grades each boundary of the ICOI 2008 scale', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      expect(await icoi(c, false, 0, 'no', 'no', 1.9, 10, null)).toBe('I');
      expect(await icoi(c, false, 0, 'no', 'no', 2.0, 10, null)).toBe('II');
      expect(await icoi(c, false, 0, 'no', 'no', 4.0, 10, null)).toBe('II');
      expect(await icoi(c, false, 0, 'no', 'no', 4.1, 10, null)).toBe('III');
      expect(await icoi(c, false, 0, 'no', 'no', 5.0, 10, null)).toBe('III');
      expect(await icoi(c, false, 0, 'no', 'no', 5.1, 10, null)).toBe('IV');
      expect(await icoi(c, false, 1, 'no', 'no', 1.0, 10, null)).toBe('III');
      expect(await icoi(c, false, 2, 'no', 'no', 1.0, 10, null)).toBe('III');
      expect(await icoi(c, false, 3, 'no', 'no', 1.0, 10, null)).toBe('III');
      expect(await icoi(c, false, 4, 'no', 'no', 1.0, 10, null)).toBe('IV');
      expect(await icoi(c, false, 0, 'no', 'yes', 1.0, 10, null)).toBe('III');
      expect(await icoi(c, false, 0, 'yes', 'no', 1.0, 10, null)).toBe('IV');
      expect(await icoi(c, false, 0, 'no', 'no', 1.0, 10, 7.0)).toBe('I');
      expect(await icoi(c, false, 0, 'no', 'no', 1.0, 10, 7.5)).toBe('III');
      expect(await icoi(c, false, 2, 'yes', 'yes', 1.0, 10, null)).toBe('IV');
      // Short implants: half the length is the IV line.
      expect(await icoi(c, false, 0, 'no', 'no', 3.5, 6, null)).toBe('IV');
      expect(await icoi(c, false, 0, 'no', 'no', 4.0, 8, null)).toBe('II');
    });
  });

  it('is not assessable when a criterion is missing, unless the implant failed', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      expect(await icoi(c, false, null, 'no', 'no', 1.0, 10, null)).toBe('not_assessable');
      expect(await icoi(c, false, 0, null, 'no', 1.0, 10, null)).toBe('not_assessable');
      expect(await icoi(c, false, 0, 'no', null, 1.0, 10, null)).toBe('not_assessable');
      expect(await icoi(c, false, 0, 'no', 'no', null, 10, null)).toBe('not_assessable');
      // An unknown length only matters when the loss could be over half of it.
      expect(await icoi(c, false, 0, 'no', 'no', 1.0, null, null)).toBe('I');
      expect(await icoi(c, false, 0, 'no', 'no', 4.0, null, null)).toBe('II');
      expect(await icoi(c, false, 0, 'no', 'no', 4.1, null, null)).toBe('not_assessable');
      expect(await icoi(c, true, null, null, null, null, null, null)).toBe('IV');
    });
  });

  it('grades the worst signs without an X-ray (owner decision 2026-10-23)', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      expect(await icoi(c, false, 0, 'yes', null, null, 10, null)).toBe('IV');
      expect(await icoi(c, false, null, 'yes', null, null, null, null)).toBe('IV');
      expect(await icoi(c, false, 4, null, null, null, 10, null)).toBe('IV');
      expect(await icoi(c, false, 4, 'no', 'no', null, 10, null)).toBe('IV');
      expect(await icoi(c, false, 2, 'no', 'no', null, 10, null)).toBe('III');
      expect(await icoi(c, false, 0, 'no', 'yes', null, 10, null)).toBe('III');
      expect(await icoi(c, false, 0, 'no', 'no', null, 10, 7.5)).toBe('III');
      expect(await icoi(c, false, 0, 'no', 'no', null, 10, null)).toBe('not_assessable');
      // A III sign needs all three signs recorded: a missing one could still prove IV.
      expect(await icoi(c, false, 2, 'no', null, null, 10, null)).toBe('not_assessable');
      expect(await icoi(c, false, 0, null, 'yes', null, 10, null)).toBe('not_assessable');
    });
  });
});

describe('implant_outcomes', () => {
  it('no baseline X-ray means not_assessable', async () => {
    await withTx(async (c) => {
      const s = await setup(c, 400);
      const site = await s.placeAt(36);
      await visit(c, site, await s.day(380), { findings: fullFindings });
      expect(await grades(c, s.patient)).toEqual([
        { site_id: site, visit_date: await s.day(380), bone_loss_mm: null, grade: 'not_assessable', reason: 'no baseline X-ray' },
      ]);
      expect(await outcome(c, site)).toMatchObject({ latest_grade: null, latest_grade_on: null, ungraded_later: 1 });
    });
  });

  it('bone loss uses baseline then latest X-ray on or before the visit', async () => {
    await withTx(async (c) => {
      const s = await setup(c, 400);
      const site = await s.placeAt(36);
      await xray(c, s.patient, 36, site, await s.day(5), 'other', 1.5);
      await xray(c, s.patient, 36, site, await s.day(10), 'baseline', 0.5);
      await visit(c, site, await s.day(300), { findings: fullFindings });
      await xray(c, s.patient, 36, site, await s.day(360), 'follow_up', 2.0, 1.0);
      await xray(c, s.patient, 36, site, await s.day(370), 'follow_up', 3.0, 1.0);
      await visit(c, site, await s.day(380), { findings: { ...fullFindings, probing_mesial: 4 } });
      await xray(c, s.patient, 36, site, await s.day(390), 'follow_up', 6.0);
      await visit(c, site, await s.day(395), { findings: { mobility: 'no', suppuration: 'no' } });
      expect(await grades(c, s.patient)).toEqual([
        { site_id: site, visit_date: await s.day(300), bone_loss_mm: null, grade: 'not_assessable', reason: 'no follow-up X-ray' },
        { site_id: site, visit_date: await s.day(380), bone_loss_mm: 2.5, grade: 'II', reason: 'bone loss 2.5 mm' },
        { site_id: site, visit_date: await s.day(395), bone_loss_mm: 5.5, grade: 'not_assessable', reason: 'pain not recorded' },
      ]);
      expect(await outcome(c, site)).toMatchObject({
        latest_grade: 'II', latest_grade_on: await s.day(380), ungraded_later: 1, last_contact: await s.day(395),
      });
    });
  });

  it('names the deciding criterion and ignores X-rays with no comparable side', async () => {
    await withTx(async (c) => {
      const s = await setup(c, 400);
      const site = await s.placeAt(36);
      await xray(c, s.patient, 36, site, await s.day(10), 'baseline', 0.5, null);
      await xray(c, s.patient, 36, site, await s.day(100), 'follow_up', null, 1.0);
      await visit(c, site, await s.day(110), { findings: fullFindings });
      await xray(c, s.patient, 36, site, await s.day(200), 'follow_up', 1.0);
      await visit(c, site, await s.day(210), { findings: { ...fullFindings, pain_score: 4 } });
      await visit(c, site, await s.day(220), { findings: { ...fullFindings, probing_buccal: 8 } });
      await visit(c, site, await s.day(230), { findings: { ...fullFindings } });
      const g = await grades(c, s.patient);
      expect(g.map((r) => [r.grade, r.reason])).toEqual([
        ['not_assessable', 'no comparable bone level'],
        ['IV', 'pain 4'],
        ['III', 'probing 8 mm'],
        ['I', 'bone loss 0.5 mm'],
      ]);
    });
  });

  it('lost to follow-up is unknown at one year', async () => {
    await withTx(async (c) => {
      const s = await setup(c, 400);
      const site = await s.placeAt(36);
      await visit(c, site, await s.day(200), { findings: fullFindings });
      await visit(c, site, await s.day(360), { attendance: 'did_not_attend' });
      expect(await outcome(c, site)).toMatchObject({
        last_contact: await s.day(200), follow_up_days: 200, event: false, event_on: null, event_time_unknown: false,
        year_1: 'unknown', year_2: 'not_reached',
      });
    });
  });

  it('a contact from day 305 survives one year; a measured X-ray counts as contact', async () => {
    await withTx(async (c) => {
      const s = await setup(c, 400);
      const seen = await s.placeAt(36);
      await visit(c, seen, await s.day(305), { findings: fullFindings });
      expect(await outcome(c, seen)).toMatchObject({ year_1: 'survived', year_2: 'not_reached', follow_up_days: 305 });
      const early = await s.placeAt(46);
      await visit(c, early, await s.day(304), { findings: fullFindings });
      expect((await outcome(c, early)).year_1).toBe('unknown');
      const xrayed = await s.placeAt(26);
      await xray(c, s.patient, 26, xrayed, await s.day(320), 'follow_up', 1.0);
      expect(await outcome(c, xrayed)).toMatchObject({ year_1: 'survived', last_contact: await s.day(320) });
    });
  });

  it('failed_in_place survives but is graded IV', async () => {
    await withTx(async (c) => {
      const s = await setup(c, 400);
      const site = await s.placeAt(36);
      await visit(c, site, await s.day(310), {
        outcome: 'failed', findings: { failure_type: 'failed_in_place', failure_reason: 'peri_implantitis' },
      });
      expect(await grades(c, s.patient)).toEqual([
        { site_id: site, visit_date: await s.day(310), bone_loss_mm: null, grade: 'IV', reason: 'failed in place' },
      ]);
      expect(await outcome(c, site)).toMatchObject({
        event: false, event_on: null, year_1: 'survived', latest_grade: 'IV', latest_grade_on: await s.day(310),
        latest_grade_reason: 'failed in place', ungraded_later: 0,
      });
    });
  });

  it('lost implant is failed at the milestone after its failure', async () => {
    await withTx(async (c) => {
      const s = await setup(c, 800);
      const late = await s.placeAt(36);
      await visit(c, late, await s.day(200), { findings: fullFindings });
      await visit(c, late, await s.day(500), {
        outcome: 'failed', findings: { failure_type: 'lost', failure_reason: 'peri_implantitis' },
      });
      expect(await outcome(c, late)).toMatchObject({
        event: true, event_on: await s.day(500), event_time_unknown: false, follow_up_days: 500, last_contact: await s.day(500),
        at_loading: 'failed', year_1: 'survived', year_2: 'failed', year_3: 'failed', year_5: 'failed', latest_grade: 'IV',
        latest_grade_reason: 'implant lost',
      });
      // Lost on day 330 after a contact on day 310: within the first year, so failed at one year.
      const early = await s.placeAt(46);
      await visit(c, early, await s.day(310), { findings: fullFindings });
      await visit(c, early, await s.day(340), {
        outcome: 'failed', findings: { failed_on: await s.day(330), failure_type: 'removed', failure_reason: 'peri_implantitis' },
      });
      expect(await outcome(c, early)).toMatchObject({
        event: true, event_on: await s.day(330), follow_up_days: 330, last_contact: await s.day(340), year_1: 'failed', year_2: 'failed',
        latest_grade: 'IV', latest_grade_on: await s.day(340), latest_grade_reason: 'implant removed',
      });
    });
  });

  it('legacy failure without a date takes the first failed visit date (owner decision 2026-10-23)', async () => {
    await withTx(async (c) => {
      const s = await setup(c, 400);
      const site = await s.placeAt(36);
      await c.query(
        `select public.add_restoration(p_patient => $1, p_stage => 'temporary', p_type => 'single_crown', p_sites => array[$2::uuid],
           p_teeth => null, p_fitted_on => $3::date, p_retention => null, p_material => null, p_delegate => null,
           p_supervisor => null, p_course => null, p_remake_reason => null, p_notes => null)`,
        [s.patient, site, await s.day(100)]);
      await visit(c, site, await s.day(350), { findings: fullFindings });
      await legacyFailure(c, site, await s.day(380), users.organizer);
      expect(await outcome(c, site)).toMatchObject({
        event: true, event_on: await s.day(380), event_time_unknown: false, last_contact: await s.day(380), follow_up_days: 380,
        at_loading: 'survived', year_1: 'survived', year_2: 'failed', year_3: 'failed', year_5: 'failed', latest_grade: 'IV',
        latest_grade_on: await s.day(380), latest_grade_reason: 'implant failed',
      });
    });
  });

  it('at_loading is not_loaded without a restoration and survived with one', async () => {
    await withTx(async (c) => {
      const s = await setup(c, 200);
      const bare = await s.placeAt(36);
      const loaded = await s.placeAt(46);
      for (const [stage, on] of [['temporary', 100], ['final', 150]] as const) {
        await c.query(
          `select public.add_restoration(p_patient => $1, p_stage => $2, p_type => 'single_crown', p_sites => array[$3::uuid],
             p_teeth => null, p_fitted_on => $4::date, p_retention => null, p_material => null, p_delegate => null,
             p_supervisor => null, p_course => null, p_remake_reason => null, p_notes => null)`,
          [s.patient, stage, loaded, await s.day(on)]);
      }
      expect(await outcome(c, bare)).toMatchObject({ loaded_on: null, at_loading: 'not_loaded' });
      expect(await outcome(c, loaded)).toMatchObject({ loaded_on: await s.day(100), at_loading: 'survived' });
    });
  });

  it('counts biological and mechanical complications, not voided ones', async () => {
    await withTx(async (c) => {
      const s = await setup(c, 200);
      const site = await s.placeAt(36);
      const add = (category: string, type: string) => c.query(
        `select public.record_complication(p_site => $1, p_details => $2::jsonb) as id`,
        [site, JSON.stringify({ category, type, noticed_on: s.placedOn })]);
      await add('biological', 'mucositis');
      const voided = (await add('biological', 'mucositis')).rows[0].id as string;
      await add('mechanical', 'abutment_fracture');
      await c.query(`select public.void_complication($1, 'Duplicate')`, [voided]);
      expect(await outcome(c, site)).toMatchObject({ biological_complications: 1, mechanical_complications: 1 });
    });
  });

  it('filters by course and placement date range', async () => {
    await withTx(async (c) => {
      const s = await setup(c, 100);
      const courseA = await makeCourse(c, await s.day(-2), await s.day(2));
      const courseB = await makeCourse(c, await s.day(-2), await s.day(2));
      await asPostgres(c);
      await enroll(c, courseA, s.delegate);
      await actAs(c, users.organizer);
      const inA = await s.placeAt(36, courseA);
      const inB = await s.placeAt(46, courseB);
      const byDates = await s.placeAt(26, courseB);
      await asPostgres(c);
      await c.query('update public.implant_sites set course_id = null where id = $1', [byDates]);
      await actAs(c, users.organizer);
      expect(await outcome(c, inA, courseA)).toMatchObject({ course_id: courseA, placed_on: s.placedOn });
      expect(await outcome(c, inB, courseA)).toBeUndefined();
      expect(await outcome(c, byDates, courseA)).toMatchObject({ course_id: courseA });
      expect(await outcome(c, inB, courseB)).toMatchObject({ course_id: courseB });
      expect(await outcome(c, byDates, courseB)).toBeUndefined();
      expect(await outcome(c, inA, null, s.placedOn, s.placedOn)).toBeDefined();
      expect(await outcome(c, inA, null, await s.day(1), null)).toBeUndefined();
      expect(await outcome(c, inA, null, null, await s.day(-1))).toBeUndefined();
      expect(await outcome(c, inA, null, null, null)).toMatchObject({ patient_id: s.patient, tooth: 36 });
    });
  });

  it('pins the one- and two-year boundaries', async () => {
    await withTx(async (c) => {
      const s = await setup(c, 700);
      const lost = async (site: string, day: number) => visit(c, site, await s.day(day), {
        outcome: 'failed', findings: { failure_type: 'lost', failure_reason: 'peri_implantitis' },
      });
      const on365 = await s.placeAt(36);
      await lost(on365, 365);
      expect(await outcome(c, on365)).toMatchObject({ event_on: await s.day(365), year_1: 'failed', year_2: 'failed' });
      const on366 = await s.placeAt(46);
      await lost(on366, 366);
      expect(await outcome(c, on366)).toMatchObject({ event_on: await s.day(366), year_1: 'survived', year_2: 'failed' });
      const seen670 = await s.placeAt(26);
      await visit(c, seen670, await s.day(670), { findings: fullFindings });
      expect(await outcome(c, seen670)).toMatchObject({ year_1: 'survived', year_2: 'survived', year_3: 'not_reached' });
      const seen669 = await s.placeAt(16);
      await visit(c, seen669, await s.day(669), { findings: fullFindings });
      expect(await outcome(c, seen669)).toMatchObject({ year_1: 'survived', year_2: 'not_reached' });
    });
  });

  it('at_loading is failed for an early failure and for an event on or before loading', async () => {
    await withTx(async (c) => {
      const s = await setup(c, 300);
      const restore = async (site: string, day: number) => c.query(
        `select public.add_restoration(p_patient => $1, p_stage => 'temporary', p_type => 'single_crown', p_sites => array[$2::uuid],
           p_teeth => null, p_fitted_on => $3::date, p_retention => null, p_material => null, p_delegate => null,
           p_supervisor => null, p_course => null, p_remake_reason => null, p_notes => null)`,
        [s.patient, site, await s.day(day)]);
      const fail = async (site: string, visitDay: number, failedDay: number) => visit(c, site, await s.day(visitDay), {
        outcome: 'failed', findings: { failed_on: await s.day(failedDay), failure_type: 'lost', failure_reason: 'no_osseointegration' },
      });
      const never = await s.placeAt(36);
      await fail(never, 50, 50);
      expect(await outcome(c, never)).toMatchObject({ loaded_on: null, at_loading: 'failed', year_1: 'failed' });
      const onLoading = await s.placeAt(46);
      await restore(onLoading, 100);
      await fail(onLoading, 150, 100);
      expect(await outcome(c, onLoading)).toMatchObject({ loaded_on: await s.day(100), at_loading: 'failed' });
      const afterLoading = await s.placeAt(26);
      await restore(afterLoading, 100);
      await fail(afterLoading, 150, 101);
      expect(await outcome(c, afterLoading)).toMatchObject({ loaded_on: await s.day(100), at_loading: 'survived' });
    });
  });

  it('an X-ray on the baseline date is not a follow-up, and planning X-rays never count', async () => {
    await withTx(async (c) => {
      const s = await setup(c, 400);
      const sameDay = await s.placeAt(36);
      await xray(c, s.patient, 36, sameDay, await s.day(10), 'baseline', 0.5);
      await xray(c, s.patient, 36, sameDay, await s.day(10), 'follow_up', 3.0);
      await visit(c, sameDay, await s.day(20), { findings: fullFindings });
      const planned = await s.placeAt(46);
      await xray(c, s.patient, 46, planned, await s.day(5), 'planning', 0.5);
      await xray(c, s.patient, 46, planned, await s.day(100), 'follow_up', 3.0);
      await visit(c, planned, await s.day(110), { findings: fullFindings });
      const rows = await grades(c, s.patient);
      expect(rows.find((r) => r.site_id === sameDay)).toMatchObject({ grade: 'not_assessable', reason: 'no follow-up X-ray' });
      expect(rows.find((r) => r.site_id === planned)).toMatchObject({ grade: 'not_assessable', reason: 'no follow-up X-ray' });
      const onlyPlanning = await s.placeAt(26);
      await xray(c, s.patient, 26, onlyPlanning, await s.day(320), 'planning', 1.0);
      expect(await outcome(c, onlyPlanning)).toMatchObject({ last_contact: null, follow_up_days: 0, year_1: 'unknown' });
    });
  });

  it('a visit without attendance (before 0045) counts as a contact and is graded', async () => {
    await withTx(async (c) => {
      const s = await setup(c, 400);
      const site = await s.placeAt(36);
      await xray(c, s.patient, 36, site, await s.day(10), 'baseline', 0.5);
      await xray(c, s.patient, 36, site, await s.day(300), 'follow_up', 1.0);
      await asPostgres(c);
      await c.query(
        `insert into public.implant_followups (site_id, date, check_type, outcome, pain_score, mobility, suppuration)
         values ($1, $2::date, '1-year', 'ok', 0, 'no', 'no')`, [site, await s.day(310)]);
      await actAs(c, users.organizer);
      expect(await grades(c, s.patient)).toEqual([
        { site_id: site, visit_date: await s.day(310), bone_loss_mm: 0.5, grade: 'I', reason: 'bone loss 0.5 mm' },
      ]);
      expect(await outcome(c, site)).toMatchObject({
        last_contact: await s.day(310), year_1: 'survived', latest_grade: 'I', latest_grade_reason: 'bone loss 0.5 mm',
      });
    });
  });

  it('a removed implant without failure details is an event with an unknown date', async () => {
    await withTx(async (c) => {
      const s = await setup(c, 400);
      const site = await s.placeAt(36);
      await visit(c, site, await s.day(320), { findings: fullFindings });
      await asPostgres(c);
      await c.query(`update public.implant_sites set state = 'removed' where id = $1`, [site]);
      await actAs(c, users.organizer);
      expect(await outcome(c, site)).toMatchObject({
        event: true, event_on: null, event_time_unknown: true, last_contact: await s.day(320), at_loading: 'failed',
        year_1: 'unknown', year_2: 'unknown', latest_grade: 'IV', latest_grade_on: null,
        latest_grade_reason: 'implant removed',
      });
    });
  });

  it('a milestone still in the future is not_reached; unknown means lost to follow-up', async () => {
    await withTx(async (c) => {
      const young = await setup(c, 364);
      const a = await young.placeAt(36);
      expect(await outcome(c, a)).toMatchObject({
        last_contact: null, year_1: 'not_reached', year_2: 'not_reached', year_3: 'not_reached', year_5: 'not_reached',
        latest_grade: null, latest_grade_on: null, latest_grade_reason: null,
      });
      // Lost early: failed at every milestone, reached or not.
      await visit(c, a, await young.day(100), {
        outcome: 'failed', findings: { failure_type: 'lost', failure_reason: 'no_osseointegration' },
      });
      expect(await outcome(c, a)).toMatchObject({ year_1: 'failed', year_5: 'failed' });
      const due = await setup(c, 365, 'Zz Outcome Patient Due');
      const b = await due.placeAt(36);
      expect(await outcome(c, b)).toMatchObject({ year_1: 'unknown', year_2: 'not_reached' });
    });
  });

  it('grades a visit with mobility or suppuration even without an X-ray', async () => {
    await withTx(async (c) => {
      const s = await setup(c, 400);
      const mobile = await s.placeAt(36);
      await visit(c, mobile, await s.day(100), { findings: { pain_score: 0, mobility: 'yes', suppuration: 'no' } });
      const pus = await s.placeAt(46);
      await visit(c, pus, await s.day(100), { findings: { pain_score: 0, mobility: 'no', suppuration: 'yes' } });
      const rows = await grades(c, s.patient);
      expect(rows.find((r) => r.site_id === mobile)).toMatchObject({ bone_loss_mm: null, grade: 'IV', reason: 'mobility' });
      expect(rows.find((r) => r.site_id === pus)).toMatchObject({ bone_loss_mm: null, grade: 'III', reason: 'suppuration' });
      expect(await outcome(c, mobile)).toMatchObject({
        latest_grade: 'IV', latest_grade_on: await s.day(100), latest_grade_reason: 'mobility',
      });
    });
  });

  it('version is outcomes-v1', async () => {
    await withTx(async (c) => {
      const s = await setup(c, 100);
      const site = await s.placeAt(36);
      expect((await outcome(c, site)).version).toBe('outcomes-v1');
      expect((await c.query('select public.outcomes_version() as v')).rows[0].v).toBe('outcomes-v1');
    });
  });

  it('a viewer without Patients view sees no rows', async () => {
    await withTx(async (c) => {
      const s = await setup(c, 400);
      const site = await s.placeAt(36);
      await visit(c, site, await s.day(380), { findings: fullFindings });
      await setPerms(c, users.viewer, { patients: 'view' });
      await actAs(c, users.viewer);
      expect(await outcome(c, site)).toBeDefined();
      expect(await grades(c, s.patient)).toHaveLength(1);
      await setPerms(c, users.viewer, { schedule: 'view', courses: 'view', inventory: 'edit' });
      await actAs(c, users.viewer);
      expect(await outcome(c, site)).toBeUndefined();
      expect(await grades(c, s.patient)).toHaveLength(0);
    });
  });
});

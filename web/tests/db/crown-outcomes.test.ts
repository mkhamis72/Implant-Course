import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs } from './helpers';
import { enroll, makeCourse, makeDelegate, makePatient, makeProduct, place, receive } from './fixtures';

const users = inject('testUsers');

const daysAgo = async (c: Client, n: number) =>
  (await c.query('select (public.cairo_today() - $1::int)::text as d', [n])).rows[0].d as string;

/** Implants placed 400 days ago; `day(n)` is placement + n days. */
async function setup(c: Client, name = 'Zz Crown Outcome Patient') {
  await actAs(c, users.organizer);
  const implant = await makeProduct(c);
  const lot = await receive(c, implant, 10, 'CRO');
  const delegate = await makeDelegate(c, 'Zz Crown Delegate');
  const patient = await makePatient(c, name);
  const placedAgo = 400;
  const placedOn = await daysAgo(c, placedAgo);
  const day = (n: number) => daysAgo(c, placedAgo - n);
  const placeAt = (tooth: number) =>
    place(c, { patient, tooth, product: implant, lot, delegate, supervisor: users.organizer, placedOn });
  return { patient, delegate, placedOn, day, placeAt };
}

const restore = async (c: Client, patient: string, sites: string[], fittedOn: string,
  o: { stage?: string; teeth?: number[]; course?: string | null; delegate?: string | null; reason?: string | null } = {}) =>
  (await c.query(
    `select public.add_restoration(p_patient => $1, p_stage => $2, p_type => $3, p_sites => $4::uuid[],
       p_teeth => $5::smallint[], p_fitted_on => $6::date, p_retention => null, p_material => null, p_delegate => $7,
       p_supervisor => null, p_course => $8, p_remake_reason => $9, p_notes => '') as id`,
    [patient, o.stage ?? 'final', sites.length > 1 ? 'bridge' : 'single_crown', sites, o.teeth ?? null, fittedOn,
     o.delegate ?? null, o.course ?? null, o.reason ?? null],
  )).rows[0].id as string;

async function visit(c: Client, site: string, date: string, outcome = 'ok', findings: Record<string, unknown> = {}) {
  await c.query(
    `select public.record_visit(p_site => $1, p_date => $2::date, p_visit_key => null, p_check_type => 'Review',
       p_attendance => 'attended', p_outcome => $3::public.followup_outcome, p_findings => $4::jsonb, p_notes => '')`,
    [site, date, outcome, JSON.stringify(findings)],
  );
}

const crowns = async (c: Client, course: string | null = null, from: string | null = null, to: string | null = null) =>
  (await c.query(
    `select restoration_id, patient_id, type, teeth, fitted_on::text, last_contact::text, follow_up_days, remade,
            remade_on::text, censored_by_implant_event, problems, version
     from public.crown_outcomes($1, $2::date, $3::date)`, [course, from, to])).rows;

describe('crown_outcomes', () => {
  it('a remade crown is an event at its end date', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await s.placeAt(36);
      const first = await restore(c, s.patient, [site], await s.day(60));
      const second = await restore(c, s.patient, [site], await s.day(200), { reason: 'Fractured' });
      const rows = await crowns(c);
      const a = rows.find((r) => r.restoration_id === first);
      expect(a).toMatchObject({
        remade: true, remade_on: await s.day(200), follow_up_days: 140, last_contact: await s.day(200),
        censored_by_implant_event: false, fitted_on: await s.day(60), type: 'single_crown', teeth: [36],
      });
      const b = rows.find((r) => r.restoration_id === second);
      expect(b).toMatchObject({ remade: false, remade_on: null, censored_by_implant_event: false });
    });
  });

  it('a replaced temporary is not listed', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await s.placeAt(36);
      const temp = await restore(c, s.patient, [site], await s.day(40), { stage: 'temporary' });
      const fin = await restore(c, s.patient, [site], await s.day(100));
      const ids = (await crowns(c)).map((r) => r.restoration_id);
      expect(ids).toContain(fin);
      expect(ids).not.toContain(temp);
    });
  });

  it("a bridge's last contact is the latest across its implants", async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const a = await s.placeAt(36);
      const b = await s.placeAt(37);
      const r = await restore(c, s.patient, [a, b], await s.day(60), { teeth: [36, 37] });
      await visit(c, a, await s.day(120));
      await visit(c, b, await s.day(300));
      await visit(c, a, await s.day(200));
      const row = (await crowns(c)).find((x) => x.restoration_id === r);
      expect(row).toMatchObject({
        type: 'bridge', last_contact: await s.day(300), follow_up_days: 240, remade: false,
        censored_by_implant_event: false,
      });
    });
  });

  it('crown censored at the first implant loss under it', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const a = await s.placeAt(36);
      const b = await s.placeAt(37);
      const r = await restore(c, s.patient, [a, b], await s.day(60), { teeth: [36, 37] });
      await visit(c, a, await s.day(100));
      await visit(c, b, await s.day(250), 'failed', { failure_type: 'lost', failure_reason: 'peri_implantitis' });
      await visit(c, a, await s.day(350));
      const row = (await crowns(c)).find((x) => x.restoration_id === r);
      expect(row).toMatchObject({
        censored_by_implant_event: true, remade: false, remade_on: null,
        last_contact: await s.day(250), follow_up_days: 190,
      });
    });
  });

  it('problem count', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await s.placeAt(36);
      const r = await restore(c, s.patient, [site], await s.day(60));
      const p1 = (await c.query(`select public.record_restoration_problem($1, $2::date, 'chipping', 'repaired', '') as id`,
        [r, await s.day(100)])).rows[0].id;
      await c.query(`select public.record_restoration_problem($1, $2::date, 'debonding', 'recemented', '')`, [r, await s.day(120)]);
      const p3 = (await c.query(`select public.record_restoration_problem($1, $2::date, 'wear', 'none', '') as id`,
        [r, await s.day(130)])).rows[0].id;
      expect((await crowns(c)).find((x) => x.restoration_id === r)!.problems).toBe(3);
      await c.query('select public.void_restoration_problem($1, $2)', [p3, 'Entered twice']);
      expect(p1).toBeTruthy();
      expect((await crowns(c)).find((x) => x.restoration_id === r)!.problems).toBe(2);
    });
  });

  it('filters by course (own or fallback) and fitted date range', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const a = await s.placeAt(36);
      const b = await s.placeAt(46);
      const f1 = await daysAgo(c, 100);
      const course = await makeCourse(c, f1, f1);
      const other = await makeCourse(c, '2020-01-01', '2020-01-02');
      await enroll(c, course, s.delegate);
      const own = await restore(c, s.patient, [a], f1, { course: other });
      const fallback = await restore(c, s.patient, [b], f1, { delegate: s.delegate });
      expect((await crowns(c, course)).map((r) => r.restoration_id)).toEqual([fallback]);
      expect((await crowns(c, other)).map((r) => r.restoration_id)).toEqual([own]);
      expect((await crowns(c, null, await daysAgo(c, 99))).filter((r) => [own, fallback].includes(r.restoration_id))).toHaveLength(0);
      expect((await crowns(c, null, f1, f1)).filter((r) => [own, fallback].includes(r.restoration_id))).toHaveLength(2);
    });
  });

  it('version', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const site = await s.placeAt(36);
      const r = await restore(c, s.patient, [site], await s.day(60));
      expect((await crowns(c)).find((x) => x.restoration_id === r)!.version).toBe('outcomes-v1');
    });
  });
});

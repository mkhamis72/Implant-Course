import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs } from './helpers';
import { makeDelegate, makePatient, makeProduct, place, receive } from './fixtures';

const users = inject('testUsers');

// Kept local: importing another test file would register its tests here too.
async function placedSite(c: Client, daysAgo = 60, name = 'Zz Failure Patient') {
  await actAs(c, users.organizer);
  const placedOn = (await c.query('select (public.cairo_today() - $1::int)::text as d', [daysAgo])).rows[0].d as string;
  const patient = await makePatient(c, name);
  const implant = await makeProduct(c);
  const lot = await receive(c, implant, 2, 'FLR');
  const delegate = await makeDelegate(c, 'Zz Failure Delegate');
  const site = await place(c, { patient, tooth: 46, product: implant, lot, delegate, supervisor: users.organizer, placedOn });
  return { patient, site, placedOn };
}

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}
const daysAgo = async (c: Client, n: number) => (await c.query('select (public.cairo_today() - $1::int)::text as d', [n])).rows[0].d as string;
const site = async (c: Client, id: string) =>
  (await c.query(`select state, failed_on::text, failure_type, failure_reason, failure_notes, updated_at::text as updated_at
                  from public.implant_sites where id = $1`, [id])).rows[0];
const toothStatus = async (c: Client, patient: string) =>
  (await c.query('select status from public.tooth_status where patient_id = $1 and tooth = 46', [patient])).rows[0]?.status;
const recordFailure = (c: Client, id: string, failedOn: string | null, type: string | null, reason: string | null, notes = '') =>
  c.query('select public.record_failure($1, $2::date, $3, $4, $5)', [id, failedOn, type, reason, notes]);
const visit = (c: Client, id: string, outcome: string | null, findings: Record<string, unknown> = {}, attendance = 'attended') =>
  c.query(`select public.record_visit($1, public.cairo_today(), null, 'Review', $2, $3::public.followup_outcome, $4::jsonb, '') as id`,
    [id, attendance, outcome, JSON.stringify(findings)]);

describe('record_failure', () => {
  it('records the failure, fails the implant and the tooth', async () => {
    await withTx(async (c) => {
      const s = await placedSite(c);
      const on = await daysAgo(c, 5);
      await recordFailure(c, s.site, on, 'removed', 'peri_implantitis', ' bone loss ');
      expect(await site(c, s.site)).toMatchObject({ state: 'failed', failed_on: on, failure_type: 'removed', failure_reason: 'peri_implantitis', failure_notes: 'bone loss' });
      expect(await toothStatus(c, s.patient)).toBe('failed');
    });
  });

  it('refuses bad dates and values; adds details to an old failure but not twice', async () => {
    await withTx(async (c) => {
      const s = await placedSite(c);
      const before = (await c.query('select ($1::date - 1)::text as d', [s.placedOn])).rows[0].d;
      await refused(c, () => recordFailure(c, s.site, before, 'lost', 'fracture'), /Enter the failure date/);
      await refused(c, () => recordFailure(c, s.site, '2999-01-01', 'lost', 'fracture'), /Enter the failure date/);
      await refused(c, () => recordFailure(c, s.site, null, 'lost', 'fracture'), /Enter the failure date/);
      await refused(c, async () => recordFailure(c, s.site, await daysAgo(c, 1), 'gone', 'fracture'), /Choose the failure type/);
      await refused(c, async () => recordFailure(c, s.site, await daysAgo(c, 1), 'lost', 'bad luck'), /Choose the failure reason/);
      // An old failure: failed through record_followup, no details yet.
      await c.query(`select public.record_followup($1, public.cairo_today(), '3-month', 'failed', '')`, [s.site]);
      expect((await site(c, s.site)).failure_type).toBeNull();
      await recordFailure(c, s.site, await daysAgo(c, 1), 'lost', 'no_osseointegration');
      await refused(c, async () => recordFailure(c, s.site, await daysAgo(c, 1), 'lost', 'other'), /failure is already recorded/);
    });
  });

  it('needs Edit on Patients and a placed implant', async () => {
    await withTx(async (c) => {
      const s = await placedSite(c);
      await actAs(c, users.viewer);
      await refused(c, async () => recordFailure(c, s.site, await daysAgo(c, 1), 'lost', 'fracture'), /permission to edit Patients/);
    });
  });
});

describe('correct_failure', () => {
  it('edits recorded details with the version it read; stale or missing details are refused', async () => {
    await withTx(async (c) => {
      const s = await placedSite(c);
      const correct = (on: string, type: string, reason: string, expected: string | null) =>
        c.query('select public.correct_failure($1, $2::date, $3, $4, $5, $6::timestamptz)', [s.site, on, type, reason, '', expected]);
      await refused(c, async () => correct(await daysAgo(c, 2), 'lost', 'fracture', (await site(c, s.site)).updated_at), /No failure details are recorded/);
      await recordFailure(c, s.site, await daysAgo(c, 5), 'removed', 'peri_implantitis');
      const v = (await site(c, s.site)).updated_at;
      const on = await daysAgo(c, 4);
      await correct(on, 'lost', 'no_osseointegration', v);
      expect(await site(c, s.site)).toMatchObject({ state: 'failed', failed_on: on, failure_type: 'lost', failure_reason: 'no_osseointegration' });
      await refused(c, () => correct(on, 'lost', 'fracture', '2026-01-01T00:00:00Z'), /changed by someone else/);
    });
  });
});

describe('failure through a visit', () => {
  it('a failed visit records visit and failure together; failed_on defaults to the visit date', async () => {
    await withTx(async (c) => {
      const s = await placedSite(c);
      await visit(c, s.site, 'failed', { failure_type: 'lost', failure_reason: 'no_osseointegration' });
      expect(await site(c, s.site)).toMatchObject({ state: 'failed', failure_type: 'lost', failed_on: await daysAgo(c, 0) });
    });
  });

  it('a failed visit without failure details records nothing', async () => {
    await withTx(async (c) => {
      const s = await placedSite(c);
      await refused(c, () => visit(c, s.site, 'failed', { failure_type: 'lost' }), /Choose the failure reason/);
      expect((await site(c, s.site)).state).toBe('placed');
      expect((await c.query('select count(*)::int as n from public.implant_followups where site_id = $1', [s.site])).rows[0].n).toBe(0);
    });
  });

  it('refuses failure details without a failed outcome, and a second set on an already failed implant', async () => {
    await withTx(async (c) => {
      const s = await placedSite(c);
      await refused(c, () => visit(c, s.site, 'ok', { failure_type: 'lost', failure_reason: 'fracture' }), /only with a "failed" outcome/);
      await visit(c, s.site, 'failed', { failure_type: 'lost', failure_reason: 'fracture' });
      await refused(c, () => visit(c, s.site, 'failed', { failure_type: 'lost', failure_reason: 'fracture' }), /failure is already recorded/);
      await visit(c, s.site, 'failed');
    });
  });

  it('voiding the visit that recorded the failure restores the implant and clears the details', async () => {
    await withTx(async (c) => {
      const s = await placedSite(c);
      const id = (await visit(c, s.site, 'failed', { failure_type: 'removed', failure_reason: 'malposition' })).rows[0].id;
      await c.query(`select public.void_followup($1, 'Wrong tooth')`, [id]);
      expect(await site(c, s.site)).toMatchObject({ state: 'placed', failed_on: null, failure_type: null, failure_reason: null, failure_notes: '' });
      expect(await toothStatus(c, s.patient)).toBe('implant_placed');
    });
  });
});

describe('visits after a failure', () => {
  it('keeps visits missed before the failure, drops later ones, and keeps the implant off the recall list', async () => {
    await withTx(async (c) => {
      // Placed 120 days ago: early review (window to day 21) and osseointegration (to day 112) missed.
      const s = await placedSite(c, 120, 'Zz Failure Visits');
      await recordFailure(c, s.site, await daysAgo(c, 4), 'lost', 'no_osseointegration'); // failed on day 116
      const { rows } = await c.query('select visit_key, status from public.implant_visits($1)', [s.patient]);
      expect(rows).toEqual([{ visit_key: 'early_review', status: 'missed' }, { visit_key: 'osseointegration', status: 'missed' }]);
      expect((await c.query('select count(*)::int as n from public.recall_list() where patient_id = $1', [s.patient])).rows[0].n).toBe(0);
    });
  });
});

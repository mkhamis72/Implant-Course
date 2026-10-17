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

async function placedSite(c: Client, daysAgo = 60, name = 'Zz Complication Patient') {
  await actAs(c, users.organizer);
  const placedOn = (await c.query('select (public.cairo_today() - $1::int)::text as d', [daysAgo])).rows[0].d as string;
  const patient = await makePatient(c, name);
  const implant = await makeProduct(c);
  const lot = await receive(c, implant, 2, 'CMP');
  const delegate = await makeDelegate(c, 'Zz Complication Delegate');
  const site = await place(c, { patient, tooth: 46, product: implant, lot, delegate, supervisor: users.organizer, placedOn });
  return { patient, site, placedOn };
}
const daysAgo = async (c: Client, n: number) => (await c.query('select (public.cairo_today() - $1::int)::text as d', [n])).rows[0].d as string;

const record = async (c: Client, site: string, d: Record<string, unknown>) =>
  (await c.query('select public.record_complication($1, $2::jsonb) as id', [site, JSON.stringify(d)])).rows[0].id as string;
const update = (c: Client, id: string, d: Record<string, unknown>, expected: string | null) =>
  c.query('select public.update_complication($1, $2::jsonb, $3::timestamptz)', [id, JSON.stringify(d), expected]);
const row = async (c: Client, id: string) =>
  (await c.query(`select category, type, other_type, noticed_on::text, severity, treatment, resolved_on::text, followup_id, notes,
                         voided_at, voided_reason, updated_at::text as updated_at
                  from public.implant_complications where id = $1`, [id])).rows[0];

describe('record_complication', () => {
  it('records a complication; open until resolved', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      const noticed = await daysAgo(c, 10);
      const id = await record(c, site, { category: 'biological', type: 'mucositis', noticed_on: noticed, severity: 'mild', treatment: ' OHI ' });
      expect(await row(c, id)).toMatchObject({
        category: 'biological', type: 'mucositis', other_type: '', noticed_on: noticed, severity: 'mild', treatment: 'OHI', resolved_on: null,
      });
    });
  });

  it('refuses a type outside its category, other without text, unknown details and bad dates', async () => {
    await withTx(async (c) => {
      const { site, placedOn } = await placedSite(c);
      const ok = { category: 'surgical', type: 'infection', noticed_on: await daysAgo(c, 5) };
      await refused(c, () => record(c, site, { ...ok, category: '' }), /Choose the complication category/);
      await refused(c, () => record(c, site, { ...ok, type: 'mucositis' }), /Choose the complication type/);
      await refused(c, () => record(c, site, { ...ok, type: 'other' }), /Describe the other complication/);
      await refused(c, () => record(c, site, { ...ok, colour: 'red' }), /Unknown detail: colour/);
      const before = (await c.query('select ($1::date - 1)::text as d', [placedOn])).rows[0].d;
      await refused(c, () => record(c, site, { ...ok, noticed_on: before }), /from the placement date to today/);
      await refused(c, () => record(c, site, { ...ok, noticed_on: '2999-01-01' }), /from the placement date to today/);
      await refused(c, () => record(c, site, { ...ok, noticed_on: '2026-02-30' }), /from the placement date to today/);
      const sixAgo = await daysAgo(c, 6);
      await refused(c, () => record(c, site, { ...ok, resolved_on: sixAgo }), /on or after the date noticed/);
      await refused(c, () => record(c, site, { ...ok, severity: 'awful' }), /Choose the severity from the list/);
      await refused(c, () => record(c, site, { ...ok, notes: 'x'.repeat(1001) }), /Keep the text shorter/);
      await record(c, site, { ...ok, type: 'other', other_type: 'Haematoma' });
    });
  });

  it('links a complication to a visit of the same implant only', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      const visit = (await c.query(
        `select public.record_visit($1, public.cairo_today(), null, 'Pain review', 'attended', 'complication', '{}'::jsonb, '') as id`, [site],
      )).rows[0].id;
      const other = await placedSite(c, 60, 'Zz Complication Other');
      const d = { category: 'biological', type: 'persistent_pain', noticed_on: await daysAgo(c, 0) };
      await refused(c, () => record(c, other.site, { ...d, followup_id: visit }), /Choose a visit of this implant/);
      await refused(c, () => record(c, site, { ...d, followup_id: 'not-a-uuid' }), /Choose a visit of this implant/);
      const id = await record(c, site, { ...d, followup_id: visit });
      expect((await row(c, id)).followup_id).toBe(visit);
    });
  });

  it('refuses a planned implant and needs Edit on Patients', async () => {
    await withTx(async (c) => {
      const { site, patient } = await placedSite(c);
      await asPostgres(c);
      const planned = (await c.query(`insert into public.implant_sites (patient_id, tooth, state) values ($1, 11, 'planned') returning id`, [patient])).rows[0].id;
      await actAs(c, users.organizer);
      const d = { category: 'surgical', type: 'infection', noticed_on: await daysAgo(c, 1) };
      await refused(c, () => record(c, planned, d), /Complications are recorded for placed implants/);
      await actAs(c, users.viewer);
      await refused(c, () => record(c, site, d), /permission to edit Patients/);
    });
  });
});

describe('update_complication and void_complication', () => {
  it('adds treatment and resolves with the version it read; a stale version is refused', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      const noticed = await daysAgo(c, 10);
      const id = await record(c, site, { category: 'biological', type: 'peri_implantitis', noticed_on: noticed });
      const first = await row(c, id);
      const resolved = await daysAgo(c, 2);
      await update(c, id, { category: 'biological', type: 'peri_implantitis', noticed_on: noticed, treatment: 'Debridement', resolved_on: resolved }, first.updated_at);
      expect(await row(c, id)).toMatchObject({ treatment: 'Debridement', resolved_on: resolved });
      await refused(c, () => update(c, id, { category: 'biological', type: 'peri_implantitis', noticed_on: noticed }, '2026-01-01T00:00:00Z'), /changed by someone else/);
      await refused(c, () => update(c, id, { category: 'biological', type: 'peri_implantitis', noticed_on: noticed }, null), /changed by someone else/);
    });
  });

  it('voids with a reason; a voided complication cannot be edited or voided again', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      const noticed = await daysAgo(c, 3);
      const id = await record(c, site, { category: 'mechanical', type: 'screw_loosening', noticed_on: noticed });
      await refused(c, () => c.query(`select public.void_complication($1, 'x')`, [id]), /at least 3 characters/);
      await c.query(`select public.void_complication($1, 'Wrong implant')`, [id]);
      expect(await row(c, id)).toMatchObject({ voided_reason: 'Wrong implant' });
      expect((await row(c, id)).voided_at).not.toBeNull();
      const v = (await row(c, id)).updated_at;
      await refused(c, () => update(c, id, { category: 'mechanical', type: 'screw_loosening', noticed_on: noticed }, v), /Complication not found/);
      await refused(c, () => c.query(`select public.void_complication($1, 'Again please')`, [id]), /Complication not found/);
    });
  });

  it('caps the reason for removing at 300 characters', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      const id = await record(c, site, { category: 'mechanical', type: 'screw_loosening', noticed_on: await daysAgo(c, 3) });
      await refused(c, () => c.query('select public.void_complication($1, $2)', [id, 'x'.repeat(301)]), /voided_reason_length/);
      await c.query('select public.void_complication($1, $2)', [id, 'x'.repeat(300)]);
    });
  });
});

describe('complications: access and history', () => {
  it('View on Patients reads; Schedule-only users and delegates read nothing', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      await record(c, site, { category: 'surgical', type: 'wound_dehiscence', noticed_on: await daysAgo(c, 50) });
      await actAs(c, users.viewer);
      expect((await c.query('select count(*)::int as n from public.implant_complications where site_id = $1', [site])).rows[0].n).toBe(1);
      await refused(c, () => c.query('delete from public.implant_complications where site_id = $1', [site]), /permission denied/);
      await setPerms(c, users.target, { schedule: 'view' });
      await actAs(c, users.target);
      expect((await c.query('select count(*)::int as n from public.implant_complications where site_id = $1', [site])).rows[0].n).toBe(0);
      await actAs(c, users.delegate);
      expect((await c.query('select count(*)::int as n from public.implant_complications')).rows[0].n).toBe(0);
    });
  });

  it('appears in the patient History', async () => {
    await withTx(async (c) => {
      const { site, patient } = await placedSite(c);
      await record(c, site, { category: 'surgical', type: 'infection', noticed_on: await daysAgo(c, 1) });
      const { rows } = await c.query('select table_name, action from public.patient_history($1)', [patient]);
      expect(rows).toEqual(expect.arrayContaining([{ table_name: 'implant_complications', action: 'INSERT' }]));
    });
  });
});

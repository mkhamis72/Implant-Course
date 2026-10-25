import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { makeCourse, makeDelegate, makePatient, place, receive, setPerms } from './fixtures';

const users = inject('testUsers');
const config = (query: Record<string, string> = { f: 'smoking', o: 'failed' }) => JSON.stringify({ version: 1, query });

async function refused(c: Client, fn: () => Promise<unknown>, pattern: RegExp) {
  await c.query('savepoint s');
  await expect(fn()).rejects.toThrow(pattern);
  await c.query('rollback to savepoint s');
}
const save = async (c: Client, id: string | null, title: string, course: string | null = null, cfg = config()) =>
  (await c.query('select public.save_analysis($1, $2, $3::jsonb, $4) as id', [id, title, cfg, course])).rows[0].id as string;
const remove = (c: Client, id: string) => c.query('select public.delete_analysis($1)', [id]);
const OWNER_ONLY = /Only the person who saved this analysis or an admin can change it/;

async function editors(c: Client) {
  await asPostgres(c);
  await setPerms(c, users.target, { patients: 'view', research: 'edit' });
  await setPerms(c, users.viewer, { patients: 'view', research: 'edit' });
}

describe('saved analyses (0079)', () => {
  it('saves a shared analysis, trimmed, owned by its creator and audited', async () => {
    await withTx(async (c) => {
      await editors(c);
      await actAs(c, users.target);
      const id = await save(c, null, ' Smoking and failure ');
      const row = (await c.query('select title, created_by, config from public.saved_analyses where id = $1', [id])).rows[0];
      expect(row).toMatchObject({ title: 'Smoking and failure', created_by: users.target, config: { version: 1, query: { f: 'smoking', o: 'failed' } } });
      await asPostgres(c);
      expect((await c.query(`select count(*)::int as n from public.audit_log where table_name = 'saved_analyses' and row_id = $1`, [id])).rows[0].n).toBe(1);
    });
  });

  it('is shared for reading, but only the creator or an admin changes it', async () => {
    await withTx(async (c) => {
      await editors(c);
      await actAs(c, users.target);
      const id = await save(c, null, 'Mine');
      await actAs(c, users.viewer);
      expect((await c.query('select id from public.saved_analyses where id = $1', [id])).rows).toHaveLength(1);
      await refused(c, () => save(c, id, 'Taken over'), OWNER_ONLY);
      await refused(c, () => remove(c, id), OWNER_ONLY);
      await actAs(c, users.target);
      await save(c, id, 'Renamed');
      await actAs(c, users.admin);
      await save(c, id, 'Admin rename');
      await remove(c, id);
      expect((await c.query('select id from public.saved_analyses where id = $1', [id])).rows).toHaveLength(0);
      await refused(c, () => save(c, id, 'Gone'), /Saved analysis not found/);
      await refused(c, () => remove(c, id), /Saved analysis not found/);
    });
  });

  it('refuses without Research edit, bad titles and bad configs; hides rows without Patients view', async () => {
    await withTx(async (c) => {
      await editors(c);
      await actAs(c, users.target);
      const id = await save(c, null, 'Visible');
      await refused(c, () => save(c, null, '   '), /Enter a title for the analysis/);
      await refused(c, () => save(c, null, 'x'.repeat(121)), /Enter a title for the analysis/);
      await refused(c, () => save(c, null, 'Bad', null, JSON.stringify({ query: {} })), /saved_analyses_config_check|violates check constraint/);
      await asPostgres(c);
      await setPerms(c, users.target, { patients: 'view', research: 'view' });
      await actAs(c, users.target);
      await refused(c, () => save(c, null, 'No edit'), /permission|not allowed|View|Edit/i);
      await asPostgres(c);
      await setPerms(c, users.target, { research: 'edit' });
      await actAs(c, users.target);
      expect((await c.query('select id from public.saved_analyses where id = $1', [id])).rows).toHaveLength(0);
      await actAs(c, users.delegate);
      expect((await c.query('select id from public.saved_analyses where id = $1', [id])).rows).toHaveLength(0);
    });
  });

  it('keeps the analysis when its course is deleted', async () => {
    await withTx(async (c) => {
      await editors(c);
      await asPostgres(c);
      const course = await makeCourse(c);
      await actAs(c, users.target);
      const id = await save(c, null, 'Course one', course, config({ course, f: 'jaw', o: 'failed' }));
      await actAs(c, users.admin);
      await c.query('select public.delete_course($1)', [course]);
      await asPostgres(c);
      expect((await c.query('select course_id from public.saved_analyses where id = $1', [id])).rows[0].course_id).toBeNull();
    });
  });

  it('analysis_codes gives the study codes of the analysed implants', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const tag = Math.random().toString(36).slice(2, 8);
      const brand = `Zz Codes ${tag}`;
      const prod = (await c.query(
        `insert into public.products (type, brand, system, diameter_mm, length_mm) values ('implant', $1, 'MD EXT', 4.0, 10) returning id`,
        [brand])).rows[0].id as string;
      const lot = await receive(c, prod, 2, `CD${tag}`);
      const delegate = await makeDelegate(c, `Zz Codes Delegate ${tag}`);
      const patient = await makePatient(c, `Zz Codes Patient ${tag}`);
      const placed = (await c.query('select (public.cairo_today() - 30)::text as d')).rows[0].d;
      await place(c, { patient, tooth: 36, product: prod, lot, delegate, supervisor: users.organizer, placedOn: placed });
      await place(c, { patient, tooth: 46, product: prod, lot, delegate, supervisor: users.organizer, placedOn: placed });
      const args = [null, null, null, null, brand, null];
      await actAs(c, users.admin);
      await c.query('select public.assign_research_codes($1, $2::date, $3::date, $4, $5, $6)', args);
      const codes = (await c.query('select * from public.analysis_codes($1, $2::date, $3::date, $4, $5, $6)', args)).rows;
      const sites = (await c.query('select site_id from public.analysis_implants($1, $2::date, $3::date, $4, $5, $6) order by site_id', args)).rows;
      expect(codes.map((r) => r.site_id)).toEqual(sites.map((r) => r.site_id));
      expect(codes.every((r) => /^I-[A-HJ-NP-Z2-9]{6}$/.test(r.implant_code) && /^P-[A-HJ-NP-Z2-9]{6}$/.test(r.patient_code))).toBe(true);
      expect(new Set(codes.map((r) => r.patient_code)).size).toBe(1);
      const expected = (await c.query(`select public.research_code('implant', $1) as code`, [codes[0].site_id])).rows[0].code;
      expect(codes[0].implant_code).toBe(expected);
      expect(codes[0].delegate_code).toBe((await c.query(`select public.research_code('delegate', $1) as code`, [delegate])).rows[0].code);
      expect(codes[0].supervisor_code).toMatch(/^S-[A-HJ-NP-Z2-9]{6}$/);
      expect(codes[0].course_code).toMatch(/^C-[A-HJ-NP-Z2-9]{6}$/);

      await asPostgres(c);
      await setPerms(c, users.target, { patients: 'view' });
      await actAs(c, users.target);
      await refused(c, () => c.query('select * from public.analysis_codes($1, $2::date, $3::date, $4, $5, $6)', args), /permission|not allowed|Research/i);
    });
  });
});

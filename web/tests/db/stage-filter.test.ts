import { describe, it, expect, inject } from 'vitest';
import type { Client } from 'pg';
import { withTx, actAs, asPostgres } from './helpers';
import { makeDelegate, makePatient, makeProduct, place, receive } from './fixtures';

const users = inject('testUsers');

async function setup(c: Client) {
  await actAs(c, users.organizer);
  const implant = await makeProduct(c);
  const lot = await receive(c, implant, 10, 'IMP');
  const delegate = await makeDelegate(c);
  const placeOn = (patient: string, tooth: number) =>
    place(c, { patient, tooth, product: implant, lot, delegate, supervisor: users.organizer });
  const fit = async (site: string, type: string) => {
    const product = type === 'final_restoration' ? null : await makeProduct(c, type);
    const fitLot = product ? await receive(c, product, 1, `${type}-lot`) : null;
    await c.query(
      `select public.fit_component_v2(p_site => $1, p_type => $2, p_fitted_on => current_date,
         p_product => $3, p_lot => $4, p_by_delegate => $5, p_by_organizer => null, p_notes => '', p_course => null)`,
      [site, type, product, fitLot, delegate],
    );
  };
  return { placeOn, fit };
}

async function search(c: Client, q: string, stages: string[]): Promise<string[]> {
  const { rows } = await c.query('select full_name from public.search_patients(q => $1, stages => $2)', [q, stages]);
  return rows.map((r) => r.full_name);
}

async function stagesOf(c: Client, patients: string[]) {
  const { rows } = await c.query(
    'select patient_id, tooth, stage from public.implant_stage_sites($1) order by patient_id, tooth',
    [patients],
  );
  return rows;
}

describe('implant stage filter', () => {
  it('matches each stage from the site state and its current component', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const planned = await makePatient(c, 'Zz Stage Planned');
      await c.query('select public.plan_implant($1, 11::smallint)', [planned]);
      const cs = await makePatient(c, 'Zz Stage Cover');
      await s.fit(await s.placeOn(cs, 36), 'cover_screw');
      const ha = await makePatient(c, 'Zz Stage Healing');
      const haSite = await s.placeOn(ha, 46);
      await s.fit(haSite, 'cover_screw');
      await s.fit(haSite, 'healing_abutment'); // the cover screw is no longer current
      const pros = await makePatient(c, 'Zz Stage Prosthetic');
      await s.fit(await s.placeOn(pros, 21), 'ti_base');
      const restored = await makePatient(c, 'Zz Stage Restored');
      await s.fit(await s.placeOn(restored, 14), 'final_restoration');
      const bare = await makePatient(c, 'Zz Stage Bare');
      await s.placeOn(bare, 25);
      const failed = await makePatient(c, 'Zz Stage Failed');
      const failedSite = await s.placeOn(failed, 37);
      await asPostgres(c);
      await c.query(`update public.implant_sites set state = 'failed' where id = $1`, [failedSite]);
      await actAs(c, users.organizer);

      expect(await search(c, 'Zz Stage', ['planned'])).toEqual(['Zz Stage Planned']);
      expect(await search(c, 'Zz Stage', ['cover_screw'])).toEqual(['Zz Stage Cover']);
      expect(await search(c, 'Zz Stage', ['healing_abutment'])).toEqual(['Zz Stage Healing']);
      expect(await search(c, 'Zz Stage', ['prosthetic'])).toEqual(['Zz Stage Prosthetic']);
      expect(await search(c, 'Zz Stage', ['restored'])).toEqual(['Zz Stage Restored']);
      expect(await search(c, 'Zz Stage', ['failed'])).toEqual(['Zz Stage Failed']);
      // Several stages match any of them; an empty list means no stage filter.
      expect(await search(c, 'Zz Stage', ['cover_screw', 'healing_abutment'])).toEqual(['Zz Stage Cover', 'Zz Stage Healing']);
      expect(await search(c, 'Zz Stage', [])).toHaveLength(7);
      // Combines with the text search.
      expect(await search(c, 'Zz Stage Heal', ['cover_screw', 'healing_abutment'])).toEqual(['Zz Stage Healing']);

      expect(await stagesOf(c, [ha, bare])).toEqual([{ patient_id: ha, tooth: 46, stage: 'healing_abutment' }]);
    });
  });

  it('ignores voided components', async () => {
    await withTx(async (c) => {
      const s = await setup(c);
      const p = await makePatient(c, 'Zz Stage Voided');
      const site = await s.placeOn(p, 36);
      await s.fit(site, 'healing_abutment');
      await asPostgres(c);
      await c.query(`update public.site_components set voided_at = now() where site_id = $1`, [site]);
      await actAs(c, users.organizer);
      expect(await search(c, 'Zz Stage Voided', ['healing_abutment'])).toEqual([]);
    });
  });

  it('matches missing and to-be-extracted teeth, ORed with the implant stages', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      const tooth = (patient: string, n: number, status: string) =>
        c.query('insert into public.tooth_status (patient_id, tooth, status) values ($1, $2, $3)', [patient, n, status]);
      const missing = await makePatient(c, 'Zz Teeth Missing');
      await tooth(missing, 14, 'missing');
      const extract = await makePatient(c, 'Zz Teeth Extract');
      await tooth(extract, 47, 'extracted');
      const present = await makePatient(c, 'Zz Teeth Present');
      await tooth(present, 11, 'present');
      const planned = await makePatient(c, 'Zz Teeth Planned');
      await c.query('select public.plan_implant($1, 36::smallint)', [planned]);

      expect(await search(c, 'Zz Teeth', ['missing'])).toEqual(['Zz Teeth Missing']);
      expect(await search(c, 'Zz Teeth', ['extracted'])).toEqual(['Zz Teeth Extract']);
      expect(await search(c, 'Zz Teeth', ['missing', 'extracted'])).toEqual(['Zz Teeth Extract', 'Zz Teeth Missing']);
      expect(await search(c, 'Zz Teeth', ['missing', 'planned'])).toEqual(['Zz Teeth Missing', 'Zz Teeth Planned']);
    });
  });

  it('keeps the two-argument call working', async () => {
    await withTx(async (c) => {
      await actAs(c, users.organizer);
      await makePatient(c, 'Zz Stage Plain');
      const { rows } = await c.query('select full_name from public.search_patients($1, $2)', ['Zz Stage Plain', false]);
      expect(rows.map((r) => r.full_name)).toEqual(['Zz Stage Plain']);
    });
  });
});

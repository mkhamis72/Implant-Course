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

async function placedSite(c: Client, extra: { torque?: number; isq?: number; boneType?: string } = {}) {
  await actAs(c, users.organizer);
  const patient = await makePatient(c, 'Zz Stability Patient');
  const implant = await makeProduct(c);
  const lot = await receive(c, implant, 2, 'STAB');
  const delegate = await makeDelegate(c, 'Zz Stability Delegate');
  const site = await place(c, {
    patient, tooth: 46, product: implant, lot, delegate, supervisor: users.organizer, placedOn: '2026-03-10', ...extra,
  });
  return { patient, site, delegate };
}

type Save = Partial<{ torque: number | null; isq: number | null; bone: string | null; expected: string | null }>;
const save = (c: Client, site: string, s: Save = {}) =>
  c.query(
    `select public.save_implant_surgery_v2(p_site => $1, p_extraction_date => null, p_placement_timing => null,
       p_soft_tissue_phenotype => null, p_keratinized_mucosa_mm => null, p_flap => null, p_torque_type => null,
       p_healing => null, p_primary_closure => null, p_grafting_performed => null,
       p_torque => $2, p_isq => $3, p_bone_type => $4, p_expected_updated_at => $5::timestamptz)`,
    [site, s.torque ?? null, s.isq ?? null, s.bone ?? null, s.expected ?? null],
  );
const stability = async (c: Client, site: string) =>
  (await c.query('select torque_ncm::float as torque_ncm, isq::float as isq, bone_type from public.implant_sites where id = $1', [site])).rows[0];
const updatedAt = async (c: Client, site: string) =>
  (await c.query('select updated_at::text as t from public.implant_surgery where site_id = $1', [site])).rows[0].t;

describe('save_implant_surgery_v2: torque, ISQ and bone type', () => {
  it('replaces save_implant_surgery, which is dropped (0056)', async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(
        `select to_regprocedure('public.save_implant_surgery(uuid, date, text, text, numeric, text, text, text, text, text, timestamptz)') as fn`,
      );
      expect(rows[0].fn).toBeNull();
    });
  });

  it('saves torque, ISQ and bone type on the implant', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      await save(c, site, { torque: 35, isq: 72, bone: 'D2' });
      expect(await stability(c, site)).toEqual({ torque_ncm: 35, isq: 72, bone_type: 'D2' });
    });
  });

  it('clears them when saved blank', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      await save(c, site, { torque: 35, isq: 72, bone: 'D2' });
      await save(c, site, { expected: await updatedAt(c, site) });
      expect(await stability(c, site)).toEqual({ torque_ncm: null, isq: null, bone_type: null });
    });
  });

  it('first save works when the placement already had torque', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c, { torque: 40 });
      await save(c, site, { torque: 45 });
      expect((await stability(c, site)).torque_ncm).toBe(45);
    });
  });

  it('leaves the implant row alone when the stability values are unchanged', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      await save(c, site, { torque: 35, isq: 72, bone: 'D2' });
      const audits = async () => {
        await asPostgres(c);
        const n = Number((await c.query(`select count(*) as n from public.audit_log where table_name = 'implant_sites' and row_id = $1`, [site])).rows[0].n);
        await actAs(c, users.organizer);
        return n;
      };
      const before = await audits();
      await save(c, site, { torque: 35, isq: 72, bone: 'D2', expected: await updatedAt(c, site) });
      expect(await audits()).toBe(before);
      await save(c, site, { torque: 36, isq: 72, bone: 'D2', expected: await updatedAt(c, site) });
      expect(await audits()).toBe(before + 1);
    });
  });

  it('refuses out-of-range values', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      await refused(c, () => save(c, site, { torque: 151 }), /torque/i);
      await refused(c, () => save(c, site, { isq: 101 }), /ISQ/);
      await refused(c, () => save(c, site, { bone: 'D5' }), /bone type/i);
    });
  });

  it('refuses a stale save', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      await refused(c, () => save(c, site, { torque: 30, expected: '2026-01-01T00:00:00Z' }), /changed by someone else/);
      await save(c, site, { torque: 30 });
      await refused(c, () => save(c, site, { torque: 32 }), /changed by someone else/);
      await refused(c, () => save(c, site, { torque: 32, expected: '2026-01-01T00:00:00Z' }), /changed by someone else/);
    });
  });

  it('needs Edit on Patients', async () => {
    await withTx(async (c) => {
      const { site } = await placedSite(c);
      await setPerms(c, users.organizer, { patients: 'view' });
      await refused(c, () => save(c, site, { torque: 30 }), /permission/i);
    });
  });

  it('correct_placement leaves stability alone', async () => {
    await withTx(async (c) => {
      const { site, delegate } = await placedSite(c, { torque: 40, isq: 70, boneType: 'D3' });
      await c.query(
        `select public.correct_placement(p_site => $1, p_placed_on => '2026-03-10'::date, p_placing_delegate => $2,
           p_assisting_delegate => null, p_supervisor => $3, p_torque => null, p_isq => null, p_bone_type => null,
           p_graft => '', p_notes => '')`,
        [site, delegate, users.organizer],
      );
      expect(await stability(c, site)).toEqual({ torque_ncm: 40, isq: 70, bone_type: 'D3' });
    });
  });
});

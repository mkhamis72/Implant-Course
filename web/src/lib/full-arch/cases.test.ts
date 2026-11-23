import { describe, it, expect } from 'vitest';
import {
  CASE_STATUS_LABELS, caseBridges, caseSchema, caseStageSchema, caseStatus, caseTitle, closeCaseSchema,
  type FullArchCase,
} from './cases';
import type { ImplantSite } from '@/lib/inventory/types';
import type { Restoration } from '@/lib/restorations/restorations';

const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

const kase = (o: Partial<FullArchCase> = {}): FullArchCase => ({
  id: 'c1', arch: 'upper', configuration: 'all_on_4', name: '', notes: '', closed_at: null, close_reason: null,
  updated_at: '2026-11-01T10:00:00Z', stages: [], ...o,
});
const site = (o: Partial<ImplantSite> & { case_id?: string | null }): ImplantSite =>
  ({ id: 's', tooth: 15, state: 'placed', case_id: 'c1', ...o }) as unknown as ImplantSite;
const resto = (o: Partial<Restoration>): Restoration =>
  ({ id: 'r', stage: 'final', type: 'full_arch', teeth: [15, 25], fitted_on: '2026-11-01', ended_on: null, end_kind: null, case_id: 'c1', site_ids: ['s'], ...o }) as unknown as Restoration;

describe('caseStatus', () => {
  it('is planned while no implant of the case is placed', () => {
    expect(caseStatus(kase(), [site({ state: 'planned' })], [])).toBe('planned');
    expect(caseStatus(kase(), [], [])).toBe('planned');
    expect(caseStatus(kase(), [site({ case_id: 'other' })], [])).toBe('planned');
  });
  it('is in treatment once an implant is placed, restored or failed', () => {
    for (const state of ['placed', 'restored', 'failed'] as const) {
      expect(caseStatus(kase(), [site({ state })], [])).toBe('in_treatment');
    }
  });
  it('is completed with a current final restoration', () => {
    expect(caseStatus(kase(), [site({})], [resto({})])).toBe('completed');
  });
  it('is completed by a full-arch final covering all four placed implants', () => {
    const four = [15, 12, 22, 25].map((tooth) => site({ id: `s${tooth}`, tooth }));
    expect(caseStatus(kase(), four, [resto({ site_ids: ['s15', 's12', 's22', 's25'] })])).toBe('completed');
  });
  it('is in treatment with a single crown final on one case implant', () => {
    const two = [site({ id: 's15', tooth: 15 }), site({ id: 's25', tooth: 25 })];
    expect(caseStatus(kase(), two, [resto({ type: 'single_crown', site_ids: ['s15'] })])).toBe('in_treatment');
    expect(caseStatus(kase(), [site({})], [resto({ type: 'single_crown' })])).toBe('in_treatment');
  });
  it('is in treatment while the finals leave a placed implant out', () => {
    const two = [site({ id: 's15', tooth: 15 }), site({ id: 's25', tooth: 25, state: 'restored' })];
    expect(caseStatus(kase(), two, [resto({ type: 'bridge', site_ids: ['s15'] })])).toBe('in_treatment');
  });
  it('is in treatment when the final is ended or a temporary, or belongs to another case', () => {
    expect(caseStatus(kase(), [site({})], [resto({ ended_on: '2026-11-05', end_kind: 'remade' })])).toBe('in_treatment');
    expect(caseStatus(kase(), [site({})], [resto({ stage: 'temporary' })])).toBe('in_treatment');
    expect(caseStatus(kase(), [site({})], [resto({ case_id: 'c2' })])).toBe('in_treatment');
  });
  it('is in treatment when the final is voided', () => {
    expect(caseStatus(kase(), [site({})], [resto({ voided_at: '2026-11-06' } as Partial<Restoration>)])).toBe('in_treatment');
  });
  it('is closed whatever else is true', () => {
    expect(caseStatus(kase({ closed_at: '2026-11-10T00:00:00Z' }), [site({})], [resto({})])).toBe('closed');
  });
  it('has labels', () => {
    expect(CASE_STATUS_LABELS).toEqual({ planned: 'Planned', in_treatment: 'In treatment', completed: 'Completed', closed: 'Closed' });
  });
});

describe('caseTitle', () => {
  it('uses the configuration label, or the name when given', () => {
    expect(caseTitle(kase())).toBe('Upper arch · All-on-4');
    expect(caseTitle(kase({ arch: 'lower', configuration: 'all_on_x' }))).toBe('Lower arch · All-on-X');
    expect(caseTitle(kase({ name: '4 + 2 zygomatic' }))).toBe('Upper arch · 4 + 2 zygomatic');
  });
});

describe('caseBridges', () => {
  // An All-on-4: 15, 12, 22, 25 placed in case c1.
  const four = [
    site({ id: 's15', tooth: 15 }), site({ id: 's12', tooth: 12 }), site({ id: 's22', tooth: 22 }), site({ id: 's25', tooth: 25 }),
  ];
  const all = ['s15', 's12', 's22', 's25'];
  it('picks the temporary and the finals linked to the case', () => {
    const t = resto({ id: 't', stage: 'temporary', site_ids: all });
    const f = resto({ id: 'f', site_ids: all, fitted_on: '2026-12-01' });
    expect(caseBridges(kase(), four, [t, f])).toMatchObject({ temporary: t, finals: [f], complete: true, deliveredOn: '2026-12-01' });
  });
  it('still shows the temporary after a final replaced it', () => {
    const t = resto({ id: 't', stage: 'temporary', site_ids: all, ended_on: '2026-12-01', end_kind: 'replaced' });
    const f = resto({ id: 'f', site_ids: all, fitted_on: '2026-12-01' });
    expect(caseBridges(kase(), four, [t, f]).temporary).toBe(t);
  });
  it('takes the latest temporary bridge, never a voided one or a single crown', () => {
    const a = resto({ id: 'a', stage: 'temporary', fitted_on: '2026-11-01', ended_on: '2026-11-08', end_kind: 'replaced' });
    const b = resto({ id: 'b', stage: 'temporary', fitted_on: '2026-11-08' });
    const voided = resto({ id: 'v', stage: 'temporary', fitted_on: '2026-11-20', voided_at: '2026-11-21' } as Partial<Restoration>);
    const crown = resto({ id: 'c', stage: 'temporary', type: 'single_crown', fitted_on: '2026-11-22' });
    expect(caseBridges(kase(), four, [a, b, voided, crown]).temporary).toBe(b);
  });
  it('ignores ended, voided, single-crown and other-case finals', () => {
    const old = resto({ id: 'old', site_ids: all, ended_on: '2026-11-02', end_kind: 'remade' });
    const other = resto({ id: 'o', site_ids: all, case_id: 'c2' });
    const voided = resto({ id: 'v', site_ids: all, voided_at: '2026-11-03' } as Partial<Restoration>);
    const crown = resto({ id: 'c', type: 'single_crown', site_ids: ['s15'] });
    expect(caseBridges(kase(), four, [old, other, voided, crown])).toMatchObject({ temporary: null, finals: [], complete: false, deliveredOn: null });
  });
  it('is complete with two bridges covering every implant, delivered on the later one', () => {
    const right = resto({ id: 'r', type: 'bridge', site_ids: ['s15', 's12'], fitted_on: '2026-12-01' });
    const left = resto({ id: 'l', type: 'bridge', site_ids: ['s22', 's25'], fitted_on: '2026-12-05' });
    expect(caseBridges(kase(), four, [right, left])).toMatchObject({ complete: true, deliveredOn: '2026-12-05' });
  });
  it('is not complete while finals leave an implant out, and says which', () => {
    const part = resto({ id: 'p', type: 'bridge', site_ids: ['s12', 's22'] });
    expect(caseBridges(kase(), four, [part])).toMatchObject({
      finals: [part], complete: false, deliveredOn: null, coveredTeeth: [12, 22], neededTeeth: [15, 12, 22, 25],
    });
  });
  it('does not need a failed implant', () => {
    const withFailed = [...four, site({ id: 's14', tooth: 14, state: 'failed' })];
    expect(caseBridges(kase(), withFailed, [resto({ site_ids: all })]).complete).toBe(true);
  });
  it('is never complete without a placed implant', () => {
    expect(caseBridges(kase(), [site({ state: 'planned' })], [resto({})]).complete).toBe(false);
  });
});

describe('schemas', () => {
  const base = { patientId: uuid(1), arch: 'upper', configuration: 'all_on_4', name: '', notes: '', sites: [uuid(2)] };
  it('accepts a case and bounds name and notes', () => {
    expect(caseSchema.safeParse(base).success).toBe(true);
    expect(caseSchema.safeParse({ ...base, name: 'x'.repeat(60) }).success).toBe(true);
    expect(caseSchema.safeParse({ ...base, name: 'x'.repeat(61) }).success).toBe(false);
    expect(caseSchema.safeParse({ ...base, notes: 'x'.repeat(1001) }).success).toBe(false);
    expect(caseSchema.safeParse({ ...base, arch: 'middle' }).success).toBe(false);
    expect(caseSchema.safeParse({ ...base, configuration: 'x' }).success).toBe(false);
  });
  it('closes only with a reason of 1-500 characters', () => {
    const c = { patientId: uuid(1), caseId: uuid(3), expectedUpdatedAt: '2026-11-01T10:00:00Z' };
    expect(closeCaseSchema.safeParse({ ...c, reason: 'Patient moved' }).success).toBe(true);
    expect(closeCaseSchema.safeParse({ ...c, reason: '  ' }).success).toBe(false);
    expect(closeCaseSchema.safeParse({ ...c, reason: 'x'.repeat(501) }).success).toBe(false);
  });
  describe('stage', () => {
    const s = { patientId: uuid(1), caseId: uuid(3), stage: 'lab_design', doneOn: '2026-01-10', lab: 'Lab A', passiveFit: '', occlusion: '', notes: '' };
    it('takes the lab only on lab_design', () => {
      expect(caseStageSchema.safeParse(s).success).toBe(true);
      expect(caseStageSchema.safeParse({ ...s, stage: 'scan' }).success).toBe(false);
      expect(caseStageSchema.safeParse({ ...s, stage: 'scan', lab: '' }).success).toBe(true);
      expect(caseStageSchema.safeParse({ ...s, lab: 'x'.repeat(121) }).success).toBe(false);
    });
    it('takes passive fit and occlusion only on try_in', () => {
      const t = { ...s, stage: 'try_in', lab: '' };
      expect(caseStageSchema.safeParse({ ...t, passiveFit: true, occlusion: 'Even' }).success).toBe(true);
      expect(caseStageSchema.safeParse({ ...t, passiveFit: false }).success).toBe(true);
      expect(caseStageSchema.safeParse({ ...t, occlusion: 'x'.repeat(501) }).success).toBe(false);
      expect(caseStageSchema.safeParse({ ...s, passiveFit: true, lab: '' }).success).toBe(false);
      expect(caseStageSchema.safeParse({ ...s, occlusion: 'Even' }).success).toBe(false);
    });
    it('needs a real date and a known stage', () => {
      expect(caseStageSchema.safeParse({ ...s, doneOn: '2026-02-31' }).success).toBe(false);
      expect(caseStageSchema.safeParse({ ...s, doneOn: '' }).success).toBe(false);
      expect(caseStageSchema.safeParse({ ...s, stage: 'delivery' }).success).toBe(false);
    });
  });
});

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
  ({ id: 'r', stage: 'final', type: 'full_arch', teeth: [15, 25], fitted_on: '2026-11-01', ended_on: null, end_kind: null, case_id: 'c1', ...o }) as unknown as Restoration;

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
  it('picks the current temporary and final linked to the case', () => {
    const t = resto({ id: 't', stage: 'temporary' });
    const f = resto({ id: 'f' });
    expect(caseBridges(kase(), [t, f])).toEqual({ temporary: t, final: f });
  });
  it('ignores ended, voided and other cases, and takes the latest of several', () => {
    const old = resto({ id: 'old', ended_on: '2026-11-02', end_kind: 'replaced' });
    const other = resto({ id: 'o', case_id: 'c2' });
    const voided = resto({ id: 'v', voided_at: '2026-11-03' } as Partial<Restoration>);
    expect(caseBridges(kase(), [old, other, voided])).toEqual({ temporary: null, final: null });
    const a = resto({ id: 'a', fitted_on: '2026-11-01' });
    const b = resto({ id: 'b', fitted_on: '2026-11-08' });
    expect(caseBridges(kase(), [a, b]).final).toBe(b);
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

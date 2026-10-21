import { describe, it, expect } from 'vitest';
import {
  daysSinceExtraction, describeGraft, describeSurgery, graftSchema, surgeryCompleteness, surgerySchema, timingWarning,
  type ImplantGraft, type ImplantSurgery,
} from './surgery';

const empty: ImplantSurgery = {
  site_id: 's1', extraction_date: null, placement_timing: null, soft_tissue_phenotype: null, keratinized_mucosa_mm: null, flap: null,
  torque_type: null, healing: null, primary_closure: null, grafting_performed: null, updated_at: '2026-10-17T10:00:00Z',
};
const full: ImplantSurgery = {
  ...empty, extraction_date: '2026-03-10', placement_timing: 'immediate', soft_tissue_phenotype: 'thick', keratinized_mucosa_mm: 0,
  flap: 'flapless', torque_type: 'peak', healing: 'submerged', primary_closure: 'yes', grafting_performed: 'no',
};
const firstError = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0].message;
const ids = { siteId: '00000000-0000-4000-8000-000000000001', patientId: '00000000-0000-4000-8000-000000000002' };

describe('days and timing', () => {
  it('counts days from extraction to placement', () => {
    expect(daysSinceExtraction('2026-03-01', '2026-03-10')).toBe(9);
    expect(daysSinceExtraction('2026-03-10', '2026-03-10')).toBe(0);
    expect(daysSinceExtraction(null, '2026-03-10')).toBeNull();
    expect(daysSinceExtraction('2026-03-01', null)).toBeNull();
  });
  it('warns only outside the usual range for the chosen timing', () => {
    expect(timingWarning('early_soft_tissue', 28)).toBeNull();
    expect(timingWarning('early_soft_tissue', 56)).toBeNull();
    expect(timingWarning('early_soft_tissue', 203)).toBe(
      'Early placement with soft-tissue healing usually means 4–8 weeks after extraction; this is 29 weeks.',
    );
    expect(timingWarning('early_partial_bone', 84)).toBeNull();
    expect(timingWarning('early_partial_bone', 113)).toBe(
      'Early placement with partial bone healing usually means 12–16 weeks after extraction; this is 16 weeks.',
    );
    expect(timingWarning('delayed', 113)).toBeNull();
    expect(timingWarning('delayed', 10)).toBe('Delayed placement usually means more than 16 weeks after extraction; this is 10 days.');
    expect(timingWarning('immediate', 0)).toBeNull();
    expect(timingWarning('immediate', 1)).toBe('An immediate placement is on the extraction day; this is 1 day after it.');
    expect(timingWarning(null, 50)).toBeNull();
    expect(timingWarning('delayed', null)).toBeNull();
  });
});

describe('completeness and summaries', () => {
  const none = { torque_ncm: null, isq: null, bone_type: null };
  const all = { torque_ncm: 35, isq: 72, bone_type: 'D2' };
  it('counts the twelve fields; zero mm counts as recorded', () => {
    expect(surgeryCompleteness(null, none)).toEqual({ recorded: 0, total: 12 });
    expect(surgeryCompleteness(empty, none)).toEqual({ recorded: 0, total: 12 });
    expect(surgeryCompleteness({ ...empty, keratinized_mucosa_mm: 0, flap: 'crestal' }, none)).toEqual({ recorded: 2, total: 12 });
    expect(surgeryCompleteness(full, all)).toEqual({ recorded: 12, total: 12 });
    expect(surgeryCompleteness(null, { torque_ncm: 35, isq: null, bone_type: 'D2' })).toEqual({ recorded: 2, total: 12 });
  });
  it('describes the recorded values in words', () => {
    expect(describeSurgery(full, '2026-03-10')).toEqual([
      'Immediate', '0 days after extraction', 'Thick phenotype', 'Keratinized mucosa 0 mm', 'Flapless', 'Peak torque',
      'Submerged (cover screw)', 'Primary closure', 'No grafting',
    ]);
    expect(describeSurgery({ ...empty, extraction_date: '2026-03-09', primary_closure: 'no', grafting_performed: 'yes' }, '2026-03-10'))
      .toEqual(['1 day after extraction', 'No primary closure', 'Grafted']);
    expect(describeSurgery(null, '2026-03-10')).toEqual([]);
  });
  it('describes a graft', () => {
    const g: ImplantGraft = {
      id: 'g1', site_id: 's1', procedure: 'gbr', timing: 'simultaneous', performed_on: null, material: 'xenograft',
      product: 'Bio-Oss 0.5 g', membrane: 'resorbable', notes: '', created_at: '2026-10-17T10:00:00Z',
    };
    expect(describeGraft(g)).toBe('GBR · Xenograft · Resorbable membrane · Simultaneous · Bio-Oss 0.5 g');
    expect(describeGraft({ ...g, timing: 'staged', performed_on: '2026-01-05', material: null, membrane: null, product: '' }))
      .toMatch(/^GBR · Staged \(.+\)$/);
  });
});

describe('schemas', () => {
  it('parses torque, ISQ and bone type, and rejects out-of-range values', () => {
    expect(surgerySchema.parse({ ...ids, torque: '', isq: '', boneType: '' })).toMatchObject({ torque: null, isq: null, boneType: null });
    expect(surgerySchema.parse({ ...ids, torque: '35', isq: '72', boneType: 'D2' })).toMatchObject({ torque: 35, isq: 72, boneType: 'D2' });
    expect(firstError(surgerySchema.safeParse({ ...ids, torque: '151' }))).toBe('Enter an insertion torque between 0 and 150 Ncm.');
    expect(firstError(surgerySchema.safeParse({ ...ids, isq: '101' }))).toBe('Enter an ISQ between 0 and 100.');
    expect(firstError(surgerySchema.safeParse({ ...ids, boneType: 'D5' }))).toBe('Choose a bone type from D1 to D4.');
  });
  it('parses the surgical details form ("" = not recorded)', () => {
    expect(surgerySchema.parse({
      ...ids, expectedUpdatedAt: '', extractionDate: '2026-03-01', placementTiming: 'delayed', softTissuePhenotype: '',
      keratinizedMucosaMm: '2.5', flap: 'crestal', torqueType: '', torque: '', isq: '', boneType: '', healing: 'transmucosal', primaryClosure: 'no', graftingPerformed: '',
    })).toEqual({
      ...ids, expectedUpdatedAt: null, extractionDate: '2026-03-01', placementTiming: 'delayed', softTissuePhenotype: null,
      keratinizedMucosaMm: 2.5, flap: 'crestal', torqueType: null, torque: null, isq: null, boneType: null, healing: 'transmucosal', primaryClosure: 'no', graftingPerformed: null,
    });
  });
  it('refuses out-of-range mucosa, a future extraction date and unknown values', () => {
    expect(firstError(surgerySchema.safeParse({ ...ids, keratinizedMucosaMm: '16' }))).toBe('Enter the keratinized mucosa width from 0 to 15 mm.');
    expect(firstError(surgerySchema.safeParse({ ...ids, extractionDate: '2999-01-01' }))).toBe('Enter a real extraction date (today or earlier).');
    expect(firstError(surgerySchema.safeParse({ ...ids, flap: 'zigzag' }))).toBe('Choose the flap from the list.');
  });
  it('parses a graft; a staged graft needs a date; a simultaneous graft drops any date', () => {
    expect(graftSchema.parse({
      ...ids, graftId: '', procedure: 'gbr', timing: 'simultaneous', performedOn: '2026-01-01', material: 'xenograft', product: ' Bio-Oss ',
      membrane: '', notes: '',
    })).toEqual({
      ...ids, graftId: null, procedure: 'gbr', timing: 'simultaneous', performedOn: null, material: 'xenograft', product: 'Bio-Oss',
      membrane: null, notes: '',
    });
    expect(firstError(graftSchema.safeParse({ ...ids, procedure: 'gbr', timing: 'staged', performedOn: '' }))).toBe(
      'Enter the date of the staged graft.',
    );
    expect(firstError(graftSchema.safeParse({ ...ids, procedure: '', timing: 'staged' }))).toBe('Choose the graft procedure.');
    expect(firstError(graftSchema.safeParse({ ...ids, procedure: 'gbr', timing: '' }))).toBe('Choose simultaneous or staged.');
    expect(firstError(graftSchema.safeParse({ ...ids, procedure: 'gbr', timing: 'simultaneous', product: 'x'.repeat(121) }))).toBe(
      'Keep the product under 120 characters.',
    );
  });
});

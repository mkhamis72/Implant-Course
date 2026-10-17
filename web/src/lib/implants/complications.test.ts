import { describe, it, expect } from 'vitest';
import {
  COMPLICATION_TYPES, complicationSchema, describeComplication, isOpen, openComplicationTeeth, toDetails, type ImplantComplication,
} from './complications';

const base: ImplantComplication = {
  id: 'c1', site_id: 's1', category: 'biological', type: 'peri_implantitis', other_type: '', noticed_on: '2026-09-01', severity: 'moderate',
  treatment: 'Debridement', resolved_on: null, followup_id: null, notes: '', voided_at: null, voided_reason: '', updated_at: '2026-09-01T10:00:00Z',
};
const firstError = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0].message;
const ids = { siteId: '00000000-0000-4000-8000-000000000001', patientId: '00000000-0000-4000-8000-000000000002' };

describe('complications', () => {
  it('lists types per category, each with "other" last', () => {
    expect(COMPLICATION_TYPES.biological).toEqual(['mucositis', 'peri_implantitis', 'progressive_bone_loss', 'suppuration', 'persistent_pain', 'soft_tissue_recession', 'other']);
    expect(COMPLICATION_TYPES.surgical.at(-1)).toBe('other');
    expect(COMPLICATION_TYPES.mechanical).toContain('screw_loosening');
  });
  it('is open until resolved; voided ones are neither open nor counted', () => {
    expect(isOpen(base)).toBe(true);
    expect(isOpen({ ...base, resolved_on: '2026-09-20' })).toBe(false);
    expect(isOpen({ ...base, voided_at: '2026-09-02T00:00:00Z' })).toBe(false);
  });
  it('describes a complication', () => {
    expect(describeComplication(base)).toMatch(/^Peri-implantitis · Moderate · noticed .+ · Debridement$/);
    expect(describeComplication({ ...base, type: 'other', other_type: 'Haematoma', severity: null, treatment: '' })).toMatch(/^Other: Haematoma · noticed /);
  });
  it('finds the teeth with an open complication', () => {
    const sites = [
      { tooth: 46, complications: [base] }, { tooth: 36, complications: [{ ...base, resolved_on: '2026-09-02' }] }, { tooth: 11, complications: [] },
    ];
    expect(openComplicationTeeth(sites)).toEqual({ 46: true });
  });
});

describe('complicationSchema', () => {
  const ok = { ...ids, complicationId: '', expectedUpdatedAt: '', category: 'mechanical', type: 'screw_loosening', otherType: '', noticedOn: '2026-09-01' };
  it('parses a complication; blank = not recorded', () => {
    expect(complicationSchema.parse({ ...ok, severity: '', treatment: ' Retightened ', resolvedOn: '', followupId: '', notes: '' })).toMatchObject({
      ...ok, complicationId: null, expectedUpdatedAt: null, severity: null, treatment: 'Retightened', resolvedOn: null, followupId: null,
    });
  });
  it('refuses a type from another category, other without text, and a resolved date before noticed', () => {
    expect(firstError(complicationSchema.safeParse({ ...ok, type: 'mucositis' }))).toBe('Choose the complication type.');
    expect(firstError(complicationSchema.safeParse({ ...ok, type: 'other' }))).toBe('Describe the other complication.');
    expect(firstError(complicationSchema.safeParse({ ...ok, resolvedOn: '2026-08-01' }))).toBe('The resolved date must be on or after the date noticed, and not in the future.');
    expect(firstError(complicationSchema.safeParse({ ...ok, noticedOn: '2999-01-01' }))).toBe('Enter when the complication was noticed (today or earlier).');
    expect(firstError(complicationSchema.safeParse({ ...ok, category: '' }))).toBe('Choose the complication category.');
  });
  it('turns the form into the database details', () => {
    const v = complicationSchema.parse({ ...ok, severity: 'mild', resolvedOn: '2026-09-05', followupId: '00000000-0000-4000-8000-000000000009' });
    expect(toDetails(v)).toEqual({
      category: 'mechanical', type: 'screw_loosening', other_type: '', noticed_on: '2026-09-01', severity: 'mild', treatment: '',
      resolved_on: '2026-09-05', followup_id: '00000000-0000-4000-8000-000000000009', notes: '',
    });
  });
});

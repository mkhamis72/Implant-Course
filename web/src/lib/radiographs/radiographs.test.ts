import { describe, it, expect } from 'vitest';
import { boneLevelLabel, coverageLabel, coverageOf, RADIOGRAPH_TYPE_LABELS, radiographSchema, teethForCoverage } from './radiographs';

const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const base = {
  patientId: uuid(1), takenOn: '2026-01-10', type: 'periapical', purpose: 'baseline', teeth: ['36'], link: '', notes: '',
};

describe('radiographSchema', () => {
  it('maps blanks to null and parses teeth', () => {
    const r = radiographSchema.parse({ ...base, teeth: '36' });
    expect(r.link).toBeNull();
    expect(r.id).toBeNull();
    expect(r.expectedUpdatedAt).toBeNull();
    expect(r.teeth).toEqual([36]);
    expect(r.levels).toEqual([]);
  });

  it('parses level rows from mesial_/distal_ fields', () => {
    const r = radiographSchema.parse({ ...base, [`mesial_${uuid(2)}`]: '0.5', [`distal_${uuid(2)}`]: '' });
    expect(r.levels).toEqual([{ site: uuid(2), mesial_mm: 0.5, distal_mm: null }]);
  });

  it('drops a row with both blank', () => {
    const r = radiographSchema.parse({ ...base, [`mesial_${uuid(2)}`]: '', [`distal_${uuid(2)}`]: '' });
    expect(r.levels).toEqual([]);
  });

  it('refuses a level above 15', () => {
    expect(radiographSchema.safeParse({ ...base, [`mesial_${uuid(2)}`]: '15.1' }).success).toBe(false);
    expect(radiographSchema.safeParse({ ...base, [`distal_${uuid(2)}`]: '-5.1' }).success).toBe(false);
    expect(radiographSchema.safeParse({ ...base, [`distal_${uuid(2)}`]: 'abc' }).success).toBe(false);
  });

  it('refuses a bad link, type and future date', () => {
    expect(radiographSchema.safeParse({ ...base, link: 'ftp://x' }).success).toBe(false);
    expect(radiographSchema.safeParse({ ...base, type: 'mri' }).success).toBe(false);
    expect(radiographSchema.safeParse({ ...base, takenOn: '2999-01-01' }).success).toBe(false);
  });
});

describe('X-ray coverage', () => {
  it('names an exact arch or the whole mouth, in any order', () => {
    expect(coverageOf(teethForCoverage('upper'))).toBe('upper');
    expect(coverageOf(teethForCoverage('lower'))).toBe('lower');
    expect(coverageOf(teethForCoverage('full'))).toBe('full');
    expect(coverageOf([...teethForCoverage('full')].reverse())).toBe('full');
    expect(teethForCoverage('full')).toHaveLength(32);
  });

  it('treats anything else as specific teeth', () => {
    expect(coverageOf([])).toBe('teeth');
    expect(coverageOf([36])).toBe('teeth');
    expect(coverageOf(teethForCoverage('upper').slice(1))).toBe('teeth');
    expect(coverageOf([...teethForCoverage('upper'), 31])).toBe('teeth');
  });

  it('labels coverage for the X-ray card', () => {
    expect(coverageLabel(teethForCoverage('full'))).toBe('Full mouth');
    expect(coverageLabel(teethForCoverage('upper'))).toBe('Upper arch');
    expect(coverageLabel(teethForCoverage('lower'))).toBe('Lower arch');
    expect(coverageLabel([36, 37])).toBe('Teeth 36, 37');
  });

  it('accepts a panoramic X-ray of the full mouth', () => {
    expect(radiographSchema.safeParse({ ...base, type: 'panoramic', teeth: teethForCoverage('full').map(String) }).success).toBe(true);
    expect(RADIOGRAPH_TYPE_LABELS.panoramic).toBe('Panorama');
  });
});

describe('boneLevelLabel', () => {
  it('shows a dash when not measured', () => {
    expect(boneLevelLabel(null)).toBe('—');
    expect(boneLevelLabel(0.5)).toBe('0.5 mm');
    expect(boneLevelLabel(-1)).toBe('-1 mm');
  });
});

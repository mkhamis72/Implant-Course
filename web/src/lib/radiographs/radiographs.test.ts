import { describe, it, expect } from 'vitest';
import { boneLevelLabel, radiographSchema } from './radiographs';

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

describe('boneLevelLabel', () => {
  it('shows a dash when not measured', () => {
    expect(boneLevelLabel(null)).toBe('—');
    expect(boneLevelLabel(0.5)).toBe('0.5 mm');
    expect(boneLevelLabel(-1)).toBe('-1 mm');
  });
});

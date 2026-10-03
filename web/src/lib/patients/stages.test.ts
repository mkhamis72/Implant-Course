import { describe, it, expect } from 'vitest';
import { parseStages, teethByPatient } from './stages';

describe('parseStages', () => {
  it('keeps known stages once, in list order', () => {
    expect(parseStages(['healing_abutment', 'bogus', 'cover_screw', 'healing_abutment'])).toEqual(['cover_screw', 'healing_abutment']);
    expect(parseStages('planned')).toEqual(['planned']);
    expect(parseStages(undefined)).toEqual([]);
  });
});

describe('teethByPatient', () => {
  it('lists each patient’s matching teeth with short labels', () => {
    const rows = [
      { patient_id: 'a', tooth: 36, stage: 'healing_abutment' },
      { patient_id: 'a', tooth: 46, stage: 'cover_screw' },
      { patient_id: 'a', tooth: 21, stage: 'planned' },
      { patient_id: 'b', tooth: 11, stage: 'restored' },
    ];
    expect(teethByPatient(rows, ['cover_screw', 'healing_abutment'])).toEqual({ a: '36 Placed·HA · 46 Placed·CS' });
  });
});

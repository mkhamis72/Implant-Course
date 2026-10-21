import { describe, it, expect } from 'vitest';
import { PATIENT_FILTERS, PATIENT_FILTER_LABELS, parseStages, teethByPatient, toothBoundFilters } from './stages';

describe('parseStages', () => {
  it('keeps known filters once, in list order', () => {
    expect(parseStages(['healing_abutment', 'bogus', 'cover_screw', 'healing_abutment'])).toEqual(['cover_screw', 'healing_abutment']);
    expect(parseStages('planned')).toEqual(['planned']);
    expect(parseStages(['planned', 'extracted', 'missing'])).toEqual(['missing', 'extracted', 'planned']);
    expect(parseStages(undefined)).toEqual([]);
  });
  it('no longer offers the prosthetic stage (an old link is ignored)', () => {
    expect(PATIENT_FILTERS).not.toContain('prosthetic');
    expect(parseStages('prosthetic')).toEqual([]);
  });
  it('accepts the scan / impression filters and labels them', () => {
    expect(parseStages(['digital_scan', 'impression_pending', 'bogus'])).toEqual(['digital_scan', 'impression_pending']);
    expect(PATIENT_FILTER_LABELS.digital_scan).toBe('Digital scan');
    expect(PATIENT_FILTER_LABELS.conventional).toBe('Conventional impression');
    expect(PATIENT_FILTER_LABELS.impression_pending).toBe('Scan / impression not yet taken');
  });
  it('splits tooth-bound filters from the scan filters', () => {
    expect(toothBoundFilters(['planned', 'digital_scan', 'conventional'])).toEqual(['planned']);
    expect(toothBoundFilters(['impression_pending'])).toEqual([]);
  });
  it('labels the chart states as the chart does', () => {
    expect(PATIENT_FILTER_LABELS.missing).toBe('Missing');
    expect(PATIENT_FILTER_LABELS.extracted).toBe('To be extracted');
  });
});

describe('teethByPatient', () => {
  it('lists each patient’s matching teeth with short labels, in tooth order', () => {
    const rows = [
      { patient_id: 'a', tooth: 36, stage: 'healing_abutment' },
      { patient_id: 'a', tooth: 46, stage: 'cover_screw' },
      { patient_id: 'a', tooth: 21, stage: 'planned' },
      { patient_id: 'b', tooth: 11, stage: 'restored' },
      { patient_id: 'a', tooth: 14, stage: 'missing' },
      { patient_id: 'b', tooth: 47, stage: 'extracted' },
    ];
    expect(teethByPatient(rows, ['missing', 'extracted', 'cover_screw', 'healing_abutment'])).toEqual({
      a: '14 Missing · 36 Placed·HA · 46 Placed·CS',
      b: '47 To extract',
    });
  });
});

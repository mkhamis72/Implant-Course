import { describe, it, expect } from 'vitest';
import { fmtMm, lotLabel, productLabel } from './labels';

const base = { brand: 'Straumann', system: 'BLX', platform: '', description: '', diameter_mm: null, length_mm: null };

describe('labels', () => {
  it('formats sizes the way dentists write them', () => {
    expect(fmtMm(4, 1)).toBe('4.0');
    expect(fmtMm(3.75, 1)).toBe('3.75');
    expect(fmtMm(10, 0)).toBe('10');
    expect(fmtMm(11.5, 0)).toBe('11.5');
  });
  it('labels implants by size and components by description', () => {
    expect(productLabel({ ...base, type: 'implant', diameter_mm: 4, length_mm: 10 })).toBe('Straumann BLX Ø4.0 × 10 mm');
    expect(productLabel({ ...base, type: 'healing_abutment', description: 'Healing abutment 5 mm' })).toBe(
      'Straumann BLX · Healing abutment 5 mm',
    );
    expect(productLabel({ ...base, type: 'ti_base', platform: 'RC' })).toBe('Straumann BLX · RC · Ti-base');
  });
  it('labels batches with lot, expiry and stock', () => {
    expect(lotLabel({ lot_no: 'A123', expiry: '2027-03-01', on_hand: 5 })).toBe('Lot A123 · exp 2027-03-01 · 5 left');
    expect(lotLabel({ lot_no: null, expiry: null, on_hand: 1 })).toBe('No lot · 1 left');
  });
});

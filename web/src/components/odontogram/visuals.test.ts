import { describe, it, expect } from 'vitest';
import { TOOTH_STATES } from '@/lib/patients/types';
import { toothVisual } from './visuals';

describe('toothVisual', () => {
  it('gives every state a distinct look', () => {
    const looks = TOOTH_STATES.map((s) => JSON.stringify(toothVisual(s)));
    expect(new Set(looks).size).toBe(TOOTH_STATES.length);
  });
  it('shows a natural tooth when present or to be extracted', () => {
    expect(toothVisual('present')).toMatchObject({ showRoots: true, glyph: 'none', dashed: false });
    expect(toothVisual('missing')).toMatchObject({ showRoots: false, glyph: 'none', dashed: true });
    // To be extracted: still present, crossed out.
    expect(toothVisual('extracted')).toMatchObject({ showRoots: true, glyph: 'cross', dashed: false });
  });
  it('draws a fixture for every implant state', () => {
    expect(toothVisual('implant_planned')).toMatchObject({ glyph: 'fixture', fixture: 'planned' });
    expect(toothVisual('implant_placed')).toMatchObject({ glyph: 'fixture', fixture: 'placed' });
    expect(toothVisual('restored')).toMatchObject({ glyph: 'fixture', fixture: 'placed', dashed: false });
    expect(toothVisual('failed')).toMatchObject({ glyph: 'fixture', fixture: 'failed' });
  });
});

import { describe, it, expect } from 'vitest';
import { isAnchored, typeLabels, typeLine, typeShortLabel } from './implant-type';

const base = { implant_type: null, angulation_deg: null, angulation_direction: null, anchorage: null } as const;

describe('implant type helpers', () => {
  it('gives the short label, none for conventional or no type', () => {
    expect(typeShortLabel('zygomatic')).toBe('ZYG');
    expect(typeShortLabel('tilted')).toBe('TLT');
    expect(typeShortLabel('pterygoid')).toBe('PTG');
    expect(typeShortLabel('conventional')).toBe('');
    expect(typeShortLabel(null)).toBe('');
  });

  it('knows which types are anchored', () => {
    expect(isAnchored('zygomatic')).toBe(true);
    expect(isAnchored('pterygoid')).toBe(true);
    expect(isAnchored('tilted')).toBe(false);
    expect(isAnchored(null)).toBe(false);
  });

  it('writes the type line', () => {
    expect(typeLine({ implant_type: 'zygomatic', angulation_deg: 45, angulation_direction: 'distal', anchorage: 'zygoma' })).toBe(
      'Zygomatic · 45° distal · Zygoma',
    );
    expect(typeLine({ ...base, implant_type: 'tilted', angulation_deg: 30 })).toBe('Tilted · 30°');
    expect(typeLine({ ...base, implant_type: 'tilted', angulation_deg: 30, angulation_direction: 'palatal_lingual' })).toBe(
      'Tilted · 30° palatal / lingual',
    );
    expect(typeLine({ ...base, implant_type: 'pterygoid', anchorage: 'pterygoid_plate' })).toBe('Pterygoid · Pterygoid plate');
    expect(typeLine({ ...base, implant_type: 'conventional', angulation_deg: 10 })).toBe('Conventional · 10°');
    expect(typeLine({ ...base, implant_type: 'conventional' })).toBe('');
    expect(typeLine(base)).toBe('');
  });

  it('labels the active site per tooth only', () => {
    expect(
      typeLabels([
        { tooth: 16, state: 'failed', implant_type: 'zygomatic' },
        { tooth: 16, state: 'placed', implant_type: 'tilted' },
        { tooth: 26, state: 'removed', implant_type: 'pterygoid' },
        { tooth: 36, state: 'placed', implant_type: 'conventional' },
        { tooth: 46, state: 'planned', implant_type: null },
        { tooth: 17, state: 'restored', implant_type: 'pterygoid' },
      ]),
    ).toEqual({ 16: 'TLT', 17: 'PTG' });
  });
});

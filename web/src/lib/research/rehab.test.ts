import { describe, expect, it } from 'vitest';
import { toRehabVars } from './rehab';

const base = { site_id: 's1', implant_type: 'zygomatic', angulation_deg: '35.5', angulation_direction: 'mesial', anchorage: 'zygoma', case_id: 'c1', case_configuration: 'all_on_4' };

describe('toRehabVars', () => {
  it('coerces numeric strings and keeps known values', () => {
    expect(toRehabVars(base)).toEqual({ ...base, angulation_deg: 35.5 });
  });
  it('turns empty and non-numeric angles into null', () => {
    expect(toRehabVars({ ...base, angulation_deg: '' }).angulation_deg).toBeNull();
    expect(toRehabVars({ ...base, angulation_deg: 'abc' }).angulation_deg).toBeNull();
    expect(toRehabVars({ ...base, angulation_deg: null }).angulation_deg).toBeNull();
  });
  it('drops unknown implant types and case configurations', () => {
    const r = toRehabVars({ ...base, implant_type: 'bogus', case_configuration: 'nope' });
    expect(r.implant_type).toBeNull();
    expect(r.case_configuration).toBeNull();
  });
});

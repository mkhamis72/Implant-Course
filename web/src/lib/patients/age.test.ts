import { describe, it, expect } from 'vitest';
import { ageOn } from './age';

describe('ageOn', () => {
  const today = new Date(2026, 9, 1); // 1 Oct 2026, local time
  it('counts completed years', () => {
    expect(ageOn('1980-10-01', today)).toBe(46);
    expect(ageOn('1980-10-02', today)).toBe(45);
  });
  it('is null without a valid date', () => {
    expect(ageOn(null, today)).toBeNull();
    expect(ageOn('garbage', today)).toBeNull();
  });
});

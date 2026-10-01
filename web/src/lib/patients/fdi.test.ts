import { describe, it, expect } from 'vitest';
import { CHART_ORDER, isFdiTooth, parseTeeth, toothType } from './fdi';

describe('FDI teeth', () => {
  it('chart order matches the paper chart', () => {
    expect(CHART_ORDER.upper).toEqual([18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]);
    expect(CHART_ORDER.lower).toEqual([48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]);
  });
  it('accepts only permanent FDI teeth', () => {
    expect([11, 18, 21, 28, 31, 38, 41, 48].every(isFdiTooth)).toBe(true);
    expect([10, 19, 20, 29, 50, 51, 9, 36.5, -36].some(isFdiTooth)).toBe(false);
  });
  it('knows tooth types', () => {
    expect([11, 22, 13, 34, 45, 16, 27, 38].map(toothType)).toEqual([
      'incisor', 'incisor', 'canine', 'premolar', 'premolar', 'molar', 'molar', 'molar',
    ]);
  });
});

describe('parseTeeth', () => {
  it('accepts commas, spaces and semicolons, de-duplicates and sorts', () => {
    expect(parseTeeth(' 46, 36;36  11 ')).toEqual({ teeth: [11, 36, 46] });
  });
  it('treats empty input as no teeth', () => {
    expect(parseTeeth('   ')).toEqual({ teeth: [] });
  });
  it.each(['19', '50', 'abc', '3 6', '36a'])('rejects %s with an actionable message', (bad) => {
    const result = parseTeeth(`36, ${bad}`);
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/is not a tooth number\. Use FDI numbers 11–48/);
  });
});

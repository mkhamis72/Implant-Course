import { describe, it, expect } from 'vitest';
import { toothShape } from './shapes';

const subpaths = (d: string) => d.split('M').filter((s) => s.trim()).length;

describe('toothShape', () => {
  it('gives every type a crown and roots', () => {
    for (const type of ['incisor', 'canine', 'premolar', 'molar'] as const) {
      const shape = toothShape(type, 'upper');
      expect(shape.crown).toMatch(/^M/);
      expect(shape.roots).toMatch(/^M/);
    }
  });
  it('draws three roots on upper molars and two on lower molars', () => {
    expect(subpaths(toothShape('molar', 'upper').roots)).toBe(3);
    expect(subpaths(toothShape('molar', 'lower').roots)).toBe(2);
    expect(subpaths(toothShape('incisor', 'lower').roots)).toBe(1);
  });
});

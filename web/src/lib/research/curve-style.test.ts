import { describe, expect, it } from 'vitest';
import { curveStyle, CURVE_COLORS } from './curve-style';

describe('curveStyle', () => {
  it('never uses a status colour', () => {
    for (const c of CURVE_COLORS) expect(c).toMatch(/^var\(--color-series-\d\)$/);
  });
  it('first curve is solid, later ones are dashed with distinct patterns', () => {
    expect(curveStyle(0).dash).toBeUndefined();
    const dashes = [1, 2, 3, 4, 5].map((i) => curveStyle(i).dash);
    expect(dashes.every(Boolean)).toBe(true);
    expect(new Set(dashes).size).toBe(5);
  });
  it('adjacent curves differ in colour', () => {
    expect(curveStyle(0).color).not.toBe(curveStyle(1).color);
  });
});

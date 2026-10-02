import { describe, it, expect } from 'vitest';
import { dashboardShortages } from './shortages';

const row = (product_id: string | null, needed: number, available: number) => ({
  product_id, needed, available, type: 'implant' as const, brand: 'B', system: 'S', platform: '', diameter_mm: 4, length_mm: 10, description: '',
});

describe('dashboardShortages (I2)', () => {
  it("counts today's need against tomorrow's stock", () => {
    const result = dashboardShortages([row('x', 2, 2)], [row('x', 1, 2)]);
    expect(result).toEqual([expect.objectContaining({ day: 'Tomorrow', product_id: 'x', needed: 1, available: 0 })]);
  });
  it('flags today when short and never shows negative stock for tomorrow', () => {
    const result = dashboardShortages([row('x', 3, 1)], [row('x', 1, 1)]);
    expect(result.map((r) => [r.day, r.needed, r.available])).toEqual([['Today', 3, 1], ['Tomorrow', 1, 0]]);
  });
  it('ignores rows without a product and days that are covered', () => {
    expect(dashboardShortages([row(null, 2, 0), row('y', 1, 5)], [row('y', 1, 5)])).toEqual([]);
  });
});

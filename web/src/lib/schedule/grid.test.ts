import { describe, it, expect } from 'vitest';
import { assignLanes, dayColumns } from './grid';

describe('assignLanes (I6)', () => {
  it('puts overlapping bookings on the same chair side by side', () => {
    const lanes = assignLanes([
      { id: 'a', chair_id: 'c1', start: 540, end: 600 },
      { id: 'b', chair_id: 'c1', start: 570, end: 630 },
      { id: 'c', chair_id: 'c1', start: 660, end: 720 },
      { id: 'd', chair_id: 'c2', start: 540, end: 600 },
    ]);
    expect(lanes).toEqual({
      a: { lane: 0, lanes: 2 },
      b: { lane: 1, lanes: 2 },
      c: { lane: 0, lanes: 1 },
      d: { lane: 0, lanes: 1 },
    });
  });
});

describe('dayColumns (I6)', () => {
  it('keeps inactive chairs that still have bookings that day', () => {
    const chairs = [
      { id: 'c1', name: 'Chair 1', active: true },
      { id: 'c2', name: 'Chair 2', active: false },
      { id: 'c3', name: 'Chair 3', active: false },
    ];
    expect(dayColumns(chairs, ['c2']).map((c) => c.name)).toEqual(['Chair 1', 'Chair 2 (inactive)']);
  });
});

import { describe, it, expect } from 'vitest';
import { groupByChair } from './by-chair';

const slot = (id: string, chair: string | null, starts_at: string) => ({ id, starts_at, chair: chair ? { name: chair } : null });

describe('groupByChair', () => {
  it('groups surgeries by chair name, chairs in name order, surgeries by start time', () => {
    const groups = groupByChair([
      slot('a', 'Chair 2', '2030-01-01T09:00:00Z'),
      slot('b', 'Chair 1', '2030-01-01T11:00:00Z'),
      slot('c', 'Chair 1', '2030-01-01T08:00:00Z'),
      slot('d', null, '2030-01-01T08:00:00Z'),
    ]);
    expect(groups.map((g) => [g.chair, g.slots.map((s) => s.id)])).toEqual([
      ['Chair 1', ['c', 'b']],
      ['Chair 2', ['a']],
      ['Chair', ['d']],
    ]);
  });
});

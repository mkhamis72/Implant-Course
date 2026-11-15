import { describe, it, expect } from 'vitest';
import { groupErrors } from './errors';

describe('groupErrors', () => {
  it('groups equal messages with their count, first and last time, the most recent kind first', () => {
    const rows = [
      { at: '2026-11-15T10:05:00Z', message: 'sendEmail failed: 535', path: null },
      { at: '2026-11-15T11:00:00Z', message: 'EMAXCONNSESSION', path: '/login' },
      { at: '2026-11-15T10:00:00Z', message: 'sendEmail failed: 535', path: null },
    ];
    expect(groupErrors(rows)).toEqual([
      { message: 'EMAXCONNSESSION', count: 1, first: '2026-11-15T11:00:00Z', last: '2026-11-15T11:00:00Z' },
      { message: 'sendEmail failed: 535', count: 2, first: '2026-11-15T10:00:00Z', last: '2026-11-15T10:05:00Z' },
    ]);
  });
  it('no rows, no groups', () => {
    expect(groupErrors([])).toEqual([]);
  });
});

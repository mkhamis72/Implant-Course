import { describe, it, expect } from 'vitest';
import { doneLabel, progressOf } from './format';

describe('checklist format', () => {
  it('summarises progress', () => {
    expect(progressOf([{ done_at: 'x' }, { done_at: null }, { done_at: 'y' }])).toEqual({ done: 2, total: 3, label: '2/3 done' });
    expect(progressOf([])).toEqual({ done: 0, total: 0, label: 'No items' });
  });
  it('labels who ticked and when (time today, date otherwise, Cairo)', () => {
    expect(doneLabel('Dr Amira', '2026-01-15T10:05:00Z', '2026-01-15')).toBe('✓ Dr Amira · 12:05');
    expect(doneLabel('Dr Amira', '2026-01-14T10:05:00Z', '2026-01-15')).toBe('✓ Dr Amira · 14 Jan 2026, 12:05');
  });
});

import { describe, it, expect } from 'vitest';
import { formatConflict } from './conflict';

describe('formatConflict', () => {
  it('names who and when', () => {
    expect(formatConflict('Dr Amira', '2026-01-15T10:05:00Z')).toBe(
      'This record was changed by Dr Amira at 12:05. Reload to see it.',
    );
  });
  it('falls back gracefully', () => {
    expect(formatConflict(null, null)).toBe('This record was changed by another user. Reload to see it.');
  });
});

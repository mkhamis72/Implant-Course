import { describe, it, expect } from 'vitest';
import { formatDate, formatDateTime, formatTime } from './format';

describe('format (Africa/Cairo)', () => {
  it('formats times as HH:MM in Cairo time', () => {
    expect(formatTime('2026-01-15T10:05:00Z')).toBe('12:05');
  });
  it('formats date-times and plain dates', () => {
    expect(formatDateTime('2026-01-15T10:05:00Z')).toBe('15 Jan 2026, 12:05');
    expect(formatDate('2026-01-15')).toBe('15 Jan 2026');
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { addDays, isRealDate, todayIso } from './dates';

afterEach(() => vi.useRealTimers());

describe('dates', () => {
  it('validates real calendar dates', () => {
    expect(isRealDate('2026-02-28')).toBe(true);
    expect(isRealDate('2026-02-30')).toBe(false);
    expect(isRealDate('28/02/2026')).toBe(false);
  });
  it('gives today in Cairo', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T22:30:00Z'));
    expect(todayIso()).toBe('2026-10-02');
  });
  it('adds days across month ends', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

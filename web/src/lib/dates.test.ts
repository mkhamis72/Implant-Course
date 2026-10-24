import { describe, it, expect, vi, afterEach } from 'vitest';
import { addDays, isRealDate, todayIso, earliestDate, latestDate } from './dates';

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

describe('latestDate / earliestDate', () => {
  it('pick the latest or earliest ISO date, ignoring empty ones', () => {
    expect(latestDate(['2026-01-02', null, '2026-03-01', ''])).toBe('2026-03-01');
    expect(earliestDate(['2026-01-02', undefined, '2026-03-01'])).toBe('2026-01-02');
  });
  it('give undefined when there is no date', () => {
    expect(latestDate([])).toBeUndefined();
    expect(earliestDate([null])).toBeUndefined();
  });
});

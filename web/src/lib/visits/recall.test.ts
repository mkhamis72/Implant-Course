import { describe, it, expect } from 'vitest';
import { parseRecallStatuses, recallCounts, type RecallRow } from './recall';

const r = (status: RecallRow['status']): RecallRow => ({
  patient_id: 'p', full_name: 'A', phone: '', site_id: 's', tooth: 36, visit_key: 'k', label: 'L',
  target_date: '2026-01-01', window_end: '2026-01-10', status,
});

describe('recall helpers', () => {
  it('reads the status filter; none or only unknown values = all three', () => {
    expect(parseRecallStatuses([])).toEqual(['overdue', 'due', 'missed']);
    expect(parseRecallStatuses(['due', 'bogus'])).toEqual(['due']);
    expect(parseRecallStatuses(['bogus'])).toEqual(['overdue', 'due', 'missed']);
  });
  it('counts rows by status', () => {
    expect(recallCounts([r('overdue'), r('overdue'), r('due'), r('missed')])).toEqual({ overdue: 2, due: 1, missed: 1 });
  });
});

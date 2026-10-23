import { describe, it, expect } from 'vitest';
import { compareGroups, groupRows, groupSummary, isCompareKey, thinWarning, type GroupVars } from './groups';
import type { DetailRow } from './view';

const row = (id: string, over: Partial<DetailRow> = {}): DetailRow => ({
  site_id: id, patient_id: `p${id}`, tooth: 11, placed_on: '2025-01-01', loaded_on: null, year_1: 'survived', year_2: 'not_reached',
  latest_grade: 'I', latest_grade_reason: null, biological_complications: 0, mechanical_complications: 0,
  follow_up_days: 400, event: false, event_time_unknown: false, product_id: 'x', brand: 'Oxy', system: 'PSK',
  patient_name: 'A', file_no: '1', ...over,
});
const vars = (id: string, over: Partial<GroupVars> = {}): GroupVars => ({
  site_id: id, technique: null, bone_type: null, smoking: null, diabetes_status: null, periodontitis_history: null, ...over,
});
const labels = (gs: { label: string; rows: unknown[]; notAssessed: boolean }[]) => gs.map((g) => `${g.label}:${g.rows.length}${g.notAssessed ? '*' : ''}`);

describe('groupRows', () => {
  it('groups by a recorded variable in a fixed order, with Not assessed last', () => {
    const rows = [row('a'), row('b'), row('c'), row('d')];
    const groups = [vars('a', { smoking: 'current' }), vars('b', { smoking: 'never' }), vars('c'), vars('d', { smoking: 'never' })];
    expect(labels(groupRows(rows, groups, 'smoking'))).toEqual(['Never:2', 'Current:1', 'Not assessed:1*']);
  });

  it('labels technique, bone type, diabetes and periodontitis', () => {
    const rows = [row('a'), row('b')];
    const groups = [
      vars('a', { technique: 'guided', bone_type: 'D2', diabetes_status: 'yes', periodontitis_history: 'no' }),
      vars('b', { technique: 'free_hand', bone_type: 'D4', diabetes_status: 'no', periodontitis_history: 'yes' }),
    ];
    expect(labels(groupRows(rows, groups, 'technique'))).toEqual(['Guided:1', 'Free hand:1']);
    expect(labels(groupRows(rows, groups, 'bone_type'))).toEqual(['D2:1', 'D4:1']);
    expect(labels(groupRows(rows, groups, 'diabetes'))).toEqual(['No:1', 'Yes:1']);
    expect(labels(groupRows(rows, groups, 'periodontitis'))).toEqual(['No:1', 'Yes:1']);
  });

  it('groups by brand, or by brand · line when there is one brand', () => {
    const one = [row('a', { system: 'PSK' }), row('b', { system: 'MD' }), row('c', { brand: null, system: null, product_id: null })];
    expect(labels(groupRows(one, [], 'brand'))).toEqual(['Oxy · MD:1', 'Oxy · PSK:1', 'No product recorded:1*']);
    const two = [row('a'), row('b', { brand: 'Alpha' })];
    expect(labels(groupRows(two, [], 'brand'))).toEqual(['Alpha:1', 'Oxy:1']);
  });

  it('groups by loading with the part-3 rule (immediate ≤ 7 days, early ≤ 2 months)', () => {
    const rows = [
      row('a', { loaded_on: '2025-01-08' }),
      row('b', { loaded_on: '2025-01-09' }),
      row('c', { loaded_on: '2025-03-01' }),
      row('d', { loaded_on: '2025-03-02' }),
      row('e'),
    ];
    expect(labels(groupRows(rows, [], 'loading'))).toEqual(['Immediate:1', 'Early:2', 'Conventional:1', 'Not loaded:1']);
  });

  it('knows its keys', () => {
    expect(isCompareKey('technique')).toBe(true);
    expect(isCompareKey('nope')).toBe(false);
  });
});

describe('compareGroups', () => {
  const at = (id: string, days: number, event: boolean, over: Partial<DetailRow> = {}) => row(id, { follow_up_days: days, event, ...over });

  it('leaves the Not assessed group out of the test', () => {
    const guided = [at('a', 100, true), at('b', 500, false), at('c', 600, false)];
    const free = [at('d', 200, true), at('e', 300, true), at('f', 700, false)];
    const missing = [at('g', 50, true), at('h', 60, true)];
    const withMissing = compareGroups([
      { label: 'Guided', rows: guided, notAssessed: false },
      { label: 'Free hand', rows: free, notAssessed: false },
      { label: 'Not assessed', rows: missing, notAssessed: true },
    ]);
    const without = compareGroups([
      { label: 'Guided', rows: guided, notAssessed: false },
      { label: 'Free hand', rows: free, notAssessed: false },
    ]);
    expect(withMissing.status).toBe('ok');
    expect(withMissing.p).toBeCloseTo(without.p as number, 10);
    expect(withMissing.n).toBe(6);
    expect(withMissing.events).toBe(3);
    expect(withMissing.thin).toBe(true);
  });

  it('needs two groups and a failure', () => {
    expect(compareGroups([{ label: 'A', rows: [at('a', 100, true)], notAssessed: false }]).status).toBe('one_group');
    expect(compareGroups([
      { label: 'A', rows: [at('a', 100, false)], notAssessed: false },
      { label: 'B', rows: [at('b', 100, false)], notAssessed: false },
    ]).status).toBe('no_failures');
  });

  it('skips failures with an unknown date and counts them', () => {
    const r = compareGroups([
      { label: 'A', rows: [at('a', 100, true), at('x', 0, true, { event_time_unknown: true })], notAssessed: false },
      { label: 'B', rows: [at('b', 300, false)], notAssessed: false },
    ]);
    expect(r.n).toBe(2);
    expect(r.unknownDate).toBe(1);
  });
});

describe('groupSummary', () => {
  it('counts implants, failures, unknown dates and ICOI I + II, with KM at 1 and 2 years', () => {
    const rows = [
      row('a', { follow_up_days: 100, event: true, latest_grade: 'IV' }),
      row('b', { follow_up_days: 800, latest_grade: 'II' }),
      row('c', { follow_up_days: 800 }),
      row('d', { follow_up_days: 800, latest_grade: null }),
      row('e', { follow_up_days: 0, event: true, event_time_unknown: true, latest_grade: 'IV' }),
    ];
    const s = groupSummary(rows);
    expect(s).toMatchObject({ implants: 5, failures: 1, unknownDate: 1, icoiGood: 2 });
    expect(s.y1.surv).toBeCloseTo(0.75);
    expect(s.y1.nRisk).toBe(3);
    expect(s.y2.surv).toBeCloseTo(0.75);
  });
});

describe('thinWarning', () => {
  it('uses the owner copy', () => {
    expect(thinWarning(12, 1)).toBe('⚠ Not enough data — interpret with caution (n = 12, 1 failure)');
    expect(thinWarning(3, 0)).toBe('⚠ Not enough data — interpret with caution (n = 3, 0 failures)');
  });
});

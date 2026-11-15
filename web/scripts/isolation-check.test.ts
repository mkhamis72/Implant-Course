import { describe, it, expect } from 'vitest';
import { evaluatePair, pairsToCheck, type TableCount } from './isolation-check';

const t = (table: string, visible: number | null, present = 3, errorCode?: string): TableCount => ({ table, visible, present, errorCode });

describe('evaluatePair', () => {
  it('passes when every table shows 0 of the other company\'s rows and the viewer sees its own settings', () => {
    const r = evaluatePair('demo', 'academy', [t('patients', 0), t('courses', 0)], 1);
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
    expect(r.lines).toContain('patients: 0 of 3 academy rows visible');
  });
  it('fails on any visible row, naming the table and the count', () => {
    const r = evaluatePair('demo', 'academy', [t('patients', 2, 5), t('courses', 0)], 1);
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(['patients: 2 of 5 academy rows visible to a demo admin']);
  });
  it('a table closed to signed-in users (permission denied) shows nothing; any other failure is a problem', () => {
    expect(evaluatePair('demo', 'academy', [t('stored_files', null, 6, '42501'), t('patients', 0)], 1).ok).toBe(true);
    const r = evaluatePair('demo', 'academy', [t('patients', null, 3, '57014')], 1);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/patients: the query failed \(57014\)/);
  });
  it('fails when the viewer cannot see its own settings (an unbound session proves nothing)', () => {
    expect(evaluatePair('demo', 'academy', [t('patients', 0)], 0).problems).toEqual([
      'a demo admin does not see its own settings row: the session is not bound, so the zeros prove nothing',
    ]);
  });
  it('fails on an empty table list', () => {
    expect(evaluatePair('demo', 'academy', [], 1).ok).toBe(false);
  });
});

describe('pairsToCheck', () => {
  it('every company looking at every other one, both ways', () => {
    expect(pairsToCheck(['academy', 'demo', 'osdic'])).toEqual([
      ['academy', 'demo'], ['academy', 'osdic'], ['demo', 'academy'], ['demo', 'osdic'], ['osdic', 'academy'], ['osdic', 'demo'],
    ]);
  });
  it('--company limits it to the pairs that company is in', () => {
    expect(pairsToCheck(['academy', 'demo', 'osdic'], 'demo')).toEqual([
      ['academy', 'demo'], ['demo', 'academy'], ['demo', 'osdic'], ['osdic', 'demo'],
    ]);
  });
  it('refuses an unknown company, and needs two companies', () => {
    expect(() => pairsToCheck(['academy', 'demo'], 'nope')).toThrow('Unknown company: nope');
    expect(() => pairsToCheck(['academy'])).toThrow('needs at least two companies');
  });
});

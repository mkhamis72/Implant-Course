import { describe, expect, it } from 'vitest';
import { evaluateSessions } from './session-check';

describe('evaluateSessions', () => {
  it('passes when every session row names the academy (or there are none yet)', () => {
    expect(evaluateSessions([{ companyId: 'a', rows: 3 }], 'a')).toEqual({ ok: true, problems: [] });
    expect(evaluateSessions([], 'a')).toEqual({ ok: true, problems: [] });
  });
  it('fails on rows of another company', () => {
    const r = evaluateSessions([{ companyId: 'a', rows: 3 }, { companyId: 'b', rows: 2 }], 'a');
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(['app.session_companies: 2 rows of company b']);
  });
});

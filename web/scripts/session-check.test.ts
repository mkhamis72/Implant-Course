import { describe, expect, it } from 'vitest';
import { evaluateSessions } from './session-check';

describe('evaluateSessions', () => {
  it('passes when every bound session belongs to a member of its company (or there are none yet)', () => {
    expect(evaluateSessions([{ company: 'academy', rows: 3, strays: 0 }])).toEqual({ ok: true, problems: [] });
    expect(evaluateSessions([{ company: 'academy', rows: 3, strays: 0 }, { company: 'canary', rows: 1, strays: 0 }])).toEqual({
      ok: true,
      problems: [],
    });
    expect(evaluateSessions([])).toEqual({ ok: true, problems: [] });
  });
  it('fails on sessions bound to a company their user is not a member of', () => {
    const r = evaluateSessions([{ company: 'academy', rows: 3, strays: 0 }, { company: 'canary', rows: 2, strays: 1 }]);
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(['app.session_companies: 1 of 2 sessions of canary belong to a user who is not its member']);
  });
});

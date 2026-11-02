import { describe, expect, it } from 'vitest';
import { evaluateCheck, type TableCount } from './one-db-check';

const ok: TableCount[] = [
  { table: 'public.patients', rows: 12, nullCompany: 0, otherCompany: 0 },
  { table: 'public.settings', rows: 0, nullCompany: 0, otherCompany: 0 },
];

describe('evaluateCheck', () => {
  it('passes when no row lacks the academy company and members match profiles', () => {
    expect(evaluateCheck(ok, { companies: 1, members: 5, profiles: 5 })).toEqual({ ok: true, problems: [] });
  });
  it('fails on a null company_id', () => {
    const r = evaluateCheck([{ ...ok[0], nullCompany: 2 }], { companies: 1, members: 5, profiles: 5 });
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(['public.patients: 2 rows with null company_id']);
  });
  it('fails on rows of another company', () => {
    const r = evaluateCheck([{ ...ok[0], otherCompany: 1 }], { companies: 1, members: 5, profiles: 5 });
    expect(r.problems).toEqual(['public.patients: 1 rows of another company']);
  });
  it('fails when members and profiles differ', () => {
    const r = evaluateCheck(ok, { companies: 1, members: 4, profiles: 5 });
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(['company_members has 4 rows but profiles has 5']);
  });
});

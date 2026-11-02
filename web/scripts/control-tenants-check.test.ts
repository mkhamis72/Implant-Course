import { describe, expect, it } from 'vitest';
import { ACADEMY_ID, evaluateControlTenants } from './control-tenants-check';

describe('evaluateControlTenants', () => {
  it("passes when the slug 'academy' exists, before and after control 0004", () => {
    expect(evaluateControlTenants([{ slug: 'academy', companyId: undefined }])).toEqual({ ok: true, problems: [] });
    expect(evaluateControlTenants([{ slug: 'academy', companyId: null }, { slug: 'other', companyId: null }]).ok).toBe(true);
    expect(evaluateControlTenants([{ slug: 'academy', companyId: ACADEMY_ID }]).ok).toBe(true);
  });
  it("fails without a tenant 'academy'", () => {
    const r = evaluateControlTenants([{ slug: 'kaleidoscope', companyId: undefined }]);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/No tenant with slug 'academy'/);
  });
  it('fails when academy carries another company', () => {
    expect(evaluateControlTenants([{ slug: 'academy', companyId: 'b0000000-0000-4000-8000-0000000000b2' }]).ok).toBe(false);
  });
});

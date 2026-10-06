import { describe, it, expect } from 'vitest';
import { securityHeaders, contentSecurityPolicy, staticSecurityHeaders } from './security-headers';

const get = (h: { key: string; value: string }[], k: string) => h.find((x) => x.key === k)?.value ?? '';

describe('securityHeaders', () => {
  it('allows only this site and the Supabase project, and no framing', () => {
    const csp = get(securityHeaders('https://abcd.supabase.co', false), 'Content-Security-Policy');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self' https://abcd.supabase.co wss://abcd.supabase.co");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-eval');
  });
  it("adds 'unsafe-eval' only in development (Next dev runtime)", () => {
    expect(get(securityHeaders('https://abcd.supabase.co', true), 'Content-Security-Policy')).toContain("'unsafe-eval'");
  });
  it('sets HSTS, nosniff, referrer and permissions policies', () => {
    const h = securityHeaders('https://abcd.supabase.co', false);
    expect(get(h, 'Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains');
    expect(get(h, 'X-Content-Type-Options')).toBe('nosniff');
    expect(get(h, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(get(h, 'Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()');
  });
});

describe('per-tenant split', () => {
  it('builds the CSP for the given company only', () => {
    const csp = contentSecurityPolicy('https://tenantb.supabase.co', false);
    expect(csp).toContain("connect-src 'self' https://tenantb.supabase.co wss://tenantb.supabase.co");
    expect(csp).not.toContain('abcd.supabase.co');
  });
  it('the static headers carry no CSP (it depends on the company)', () => {
    expect(staticSecurityHeaders().map((h) => h.key)).toEqual([
      'Strict-Transport-Security', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy',
    ]);
  });
});

import { describe, it, expect } from 'vitest';
import { blockedResponse, forwardHeaders } from './responses';

describe('forwardHeaders', () => {
  it('replaces a spoofed x-tenant with the trusted slug and keeps other headers', () => {
    const h = forwardHeaders(new Headers({ 'x-tenant': 'other-company', cookie: 'a=1' }), 'academy');
    expect(h.get('x-tenant')).toBe('academy');
    expect(h.get('cookie')).toBe('a=1');
  });
});

describe('blockedResponse', () => {
  it.each([
    ['not-found', 404, 'Not found'],
    ['suspended', 503, 'This site is temporarily unavailable'],
    ['unavailable', 503, 'Service unavailable'],
  ] as const)('%s → %i', async (kind, status, text) => {
    const r = blockedResponse(kind);
    expect(r.status).toBe(status);
    expect(await r.text()).toContain(text);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
const h = vi.hoisted(() => ({
  routeHost: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
  hasTotp: vi.fn(),
  issueDbToken: vi.fn(),
  timeout: 30,
}));
vi.mock('@/lib/tenant/route', () => ({ routeHost: (host: string | null) => h.routeHost(host) }));
vi.mock('@/lib/self-auth/tenant', () => ({
  tenantAuth: async () => ({
    getSession: h.getSession,
    signOut: h.signOut,
    issueDbToken: h.issueDbToken,
    totp: { hasTotp: h.hasTotp },
  }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ maybeSingle: async () => ({ data: { session_timeout_minutes: h.timeout } }) }) }),
  }),
}));

import { updateSession } from './middleware';

const A = 'a7c0de00-0000-4000-8000-000000000001';
const tenant = { slug: 'academy', supabaseUrl: 'https://academy-ref.supabase.co', anonKey: 'anon', companyId: A };
const session = (over: Record<string, unknown> = {}) => ({
  sessionId: 's1', userId: 'u1', companyId: A, email: 'u@example.com', aal: 'aal1', expiresAt: new Date(Date.now() + 1e6), ...over,
});

function request(path = '/patients', cookie = '') {
  return new NextRequest(`http://academy.example.com${path}`, {
    headers: { host: 'academy.example.com', 'x-tenant': 'evil', ...(cookie ? { cookie } : {}) },
  });
}
const setCookies = (res: Response) => res.headers.getSetCookie().join('\n');
const location = (res: Response) => new URL(res.headers.get('location')!);

beforeEach(() => {
  h.routeHost.mockReset().mockResolvedValue({ kind: 'tenant', tenant });
  h.getSession.mockReset().mockResolvedValue(null);
  h.signOut.mockReset().mockResolvedValue(undefined);
  h.hasTotp.mockReset().mockResolvedValue(false);
  h.issueDbToken.mockReset().mockResolvedValue('db-jwt');
  h.timeout = 30;
});

describe('updateSession', () => {
  it.each([
    ['not-found', 404],
    ['suspended', 503],
    ['unavailable', 503],
  ] as const)('%s is blocked without touching Self-Auth', async (kind, status) => {
    h.routeHost.mockResolvedValue({ kind });
    const res = await updateSession(request('/patients', 'icm_session=tok'));
    expect(res.status).toBe(status);
    expect(h.getSession).not.toHaveBeenCalled();
  });

  it('forwards the trusted tenant slug, not a browser-sent one', async () => {
    const res = await updateSession(request('/login'));
    expect(res.headers.get('x-middleware-request-x-tenant')).toBe('academy');
  });

  it('redirects an unauthenticated protected request to login with the tenant CSP', async () => {
    const res = await updateSession(request());
    expect(res.status).toBe(307);
    expect(location(res).pathname).toBe('/login');
    expect(res.headers.get('content-security-policy')).toContain('https://academy-ref.supabase.co');
    expect(h.getSession).not.toHaveBeenCalled();
  });

  it('anon_paths_still_work: /login without a cookie passes', async () => {
    const res = await updateSession(request('/login'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-request-x-tenant')).toBe('academy');
  });

  it('session_cookie_is_company_bound: a cookie that is no session here is cleared and sent to /login', async () => {
    h.getSession.mockResolvedValue(null); // Self-Auth: a session of another company is "not found"
    const res = await updateSession(request('/patients', 'icm_session=other-company-token'));
    expect(h.getSession).toHaveBeenCalledWith('other-company-token', A);
    expect(res.status).toBe(307);
    expect(location(res).pathname).toBe('/login');
    expect(setCookies(res)).toMatch(/icm_session=;/);
    expect(setCookies(res)).toMatch(/Max-Age=0/i);
  });

  it('a stale cookie on a public page is cleared too', async () => {
    const res = await updateSession(request('/login', 'icm_session=stale'));
    expect(res.status).toBe(200);
    expect(setCookies(res)).toMatch(/icm_session=;/);
  });

  it('a valid session passes a protected page and stamps last-seen', async () => {
    h.getSession.mockResolvedValue(session());
    const res = await updateSession(request('/patients', 'icm_session=tok'));
    expect(res.status).toBe(200);
    expect(setCookies(res)).toMatch(/icm_last_seen=\d+/);
    expect(setCookies(res)).not.toMatch(/icm_session=;/);
  });

  it('aal1_with_factor_goes_to_mfa', async () => {
    h.getSession.mockResolvedValue(session({ aal: 'aal1' }));
    h.hasTotp.mockResolvedValue(true);
    const res = await updateSession(request('/patients', 'icm_session=tok'));
    expect(h.hasTotp).toHaveBeenCalledWith('u1');
    expect(res.status).toBe(307);
    expect(location(res).pathname).toBe('/login/mfa');
  });

  it('aal2 with a factor goes through, and /login bounces home', async () => {
    h.getSession.mockResolvedValue(session({ aal: 'aal2' }));
    h.hasTotp.mockResolvedValue(true);
    expect((await updateSession(request('/patients', 'icm_session=tok'))).status).toBe(200);
    const login = await updateSession(request('/login', 'icm_session=tok'));
    expect(location(login).pathname).toBe('/');
  });

  it('aal1 without a factor goes through', async () => {
    h.getSession.mockResolvedValue(session({ aal: 'aal1' }));
    expect((await updateSession(request('/patients', 'icm_session=tok'))).status).toBe(200);
  });

  it('idle_timeout_signs_out: an idle session is ended in Self-Auth and its cookie cleared', async () => {
    h.getSession.mockResolvedValue(session());
    h.timeout = 30;
    const old = Date.now() - 31 * 60_000;
    const res = await updateSession(request('/patients', `icm_session=tok; icm_last_seen=${old}`));
    expect(h.signOut).toHaveBeenCalledWith('tok');
    expect(res.status).toBe(307);
    expect(location(res).pathname).toBe('/login');
    expect(location(res).searchParams.get('reason')).toBe('idle');
    expect(setCookies(res)).toMatch(/icm_session=;/);
    expect(setCookies(res)).toMatch(/icm_last_seen=;/);
  });

  it('a failed idle sign-out is not swallowed into a quiet pass', async () => {
    h.getSession.mockResolvedValue(session());
    h.signOut.mockRejectedValue(new Error('db down'));
    const old = Date.now() - 31 * 60_000;
    await expect(updateSession(request('/patients', `icm_session=tok; icm_last_seen=${old}`))).rejects.toThrow();
  });

  it('never puts the token in a redirect URL', async () => {
    const res = await updateSession(request('/patients', 'icm_session=secret-token'));
    expect(res.headers.get('location')).not.toContain('secret-token');
  });
});

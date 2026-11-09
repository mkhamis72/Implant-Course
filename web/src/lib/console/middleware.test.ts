import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
const h = vi.hoisted(() => ({ getSession: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/self-auth/console', () => ({ CONSOLE_COMPANY: 'console', consoleAuth: async () => ({ getSession: h.getSession, signOut: h.signOut }) }));
// The real module pulls in the company registry (server-only); only its cookie options are needed here.
vi.mock('@/lib/supabase/middleware', () => ({ lastSeenCookieOptions: { httpOnly: true, sameSite: 'lax', secure: false, path: '/' } }));

import { updateConsoleSession, CONSOLE_LAST_SEEN_COOKIE } from './middleware';

const ENV = {
  CONTROL_SUPABASE_URL: 'https://control-ref.supabase.co',
  NEXT_PUBLIC_CONTROL_ANON_KEY: 'anon',
  CONTROL_SERVICE_ROLE_KEY: 'service',
};

const SESSION = 'icm_console_session=tok';
function request(path: string, ...cookies: string[]) {
  const headers: Record<string, string> = { host: 'console.example.com', 'x-tenant': 'evil' };
  if (cookies.length) headers.cookie = cookies.join('; ');
  return new NextRequest(`http://console.example.com${path}`, { headers });
}

const fresh = `${CONSOLE_LAST_SEEN_COOKIE}=${Date.now()}`;
const stale = `${CONSOLE_LAST_SEEN_COOKIE}=${Date.now() - 16 * 60_000}`;

beforeEach(() => {
  h.getSession.mockReset();
  h.signOut.mockReset();
  h.getSession.mockResolvedValue({ sessionId: 's', userId: 'u' });
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
});
afterEach(() => vi.unstubAllEnvs());

describe('updateConsoleSession', () => {
  it('does not forward a browser-sent x-tenant header', async () => {
    const res = await updateConsoleSession(request('/console', SESSION, fresh));
    expect(res.headers.get('x-middleware-request-x-tenant')).toBeNull();
  });

  it('allows only the control project in the CSP', async () => {
    const res = await updateConsoleSession(request('/console', SESSION, fresh));
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain('https://control-ref.supabase.co');
    expect(csp).not.toContain('academy');
  });

  it('resolves the session as company console', async () => {
    await updateConsoleSession(request('/console', SESSION, fresh));
    expect(h.getSession).toHaveBeenCalledWith('tok', 'console');
  });

  it('refreshes the last-seen cookie for an active session', async () => {
    const res = await updateConsoleSession(request('/console', SESSION, fresh));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain(`${CONSOLE_LAST_SEEN_COOKIE}=`);
  });

  it('signs out and redirects to the console login when idle', async () => {
    const res = await updateConsoleSession(request('/console/companies', SESSION, stale));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.pathname + location.search).toBe('/console/login?reason=idle');
    expect(h.signOut).toHaveBeenCalledWith('tok');
    expect(res.headers.get('set-cookie')).toContain(`${CONSOLE_LAST_SEEN_COOKIE}=;`);
    expect(res.headers.get('set-cookie')).toContain('icm_console_session=;');
  });

  it('still clears the cookie and redirects when the sign-out fails (no 500), logging only the name', async () => {
    h.signOut.mockRejectedValue(Object.assign(new Error('secret-token-in-message'), { name: 'PgError' }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await updateConsoleSession(request('/console/companies', SESSION, stale));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location') ?? '').pathname).toBe('/console/login');
    expect(res.headers.get('set-cookie')).toContain('icm_console_session=;');
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-token');
    expect(JSON.stringify(log.mock.calls)).toContain('PgError');
    log.mockRestore();
  });

  it('treats a missing last-seen cookie (new browser session) as idle', async () => {
    const res = await updateConsoleSession(request('/console', SESSION));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.pathname + location.search).toBe('/console/login?reason=idle');
    expect(h.signOut).toHaveBeenCalledWith('tok');
  });

  it('treats an unparseable last-seen cookie as idle', async () => {
    const res = await updateConsoleSession(request('/console', SESSION, `${CONSOLE_LAST_SEEN_COOKIE}=abc`));
    expect(res.status).toBe(307);
  });

  it('drops a cookie with no session behind it and sends the visitor to the login page', async () => {
    h.getSession.mockResolvedValue(null);
    const res = await updateConsoleSession(request('/console', SESSION, fresh));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location') ?? '').pathname).toBe('/console/login');
    expect(res.headers.get('set-cookie')).toMatch(/icm_console_session=;.*Max-Age=0/);
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it('drops a dead cookie on the login page and lets it load', async () => {
    h.getSession.mockResolvedValue(null);
    const res = await updateConsoleSession(request('/console/login', SESSION));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('icm_console_session=;');
  });

  it('leaves the sign-out route to clear a dead cookie itself', async () => {
    h.getSession.mockResolvedValue(null);
    const res = await updateConsoleSession(request('/console/signout?reason=not-admin', SESSION));
    expect(res.status).toBe(200);
  });

  it('does no lookup without a session cookie', async () => {
    const res = await updateConsoleSession(request('/console'));
    expect(res.status).toBe(200);
    expect(h.getSession).not.toHaveBeenCalled();
  });

  it('does not redirect on the login page without a last-seen cookie', async () => {
    const res = await updateConsoleSession(request('/console/login', SESSION));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it('does not redirect on the login page itself', async () => {
    const res = await updateConsoleSession(request('/console/login', SESSION, stale));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('leaves the emailed reset page open', async () => {
    const res = await updateConsoleSession(request('/console/auth/reset', SESSION, stale));
    expect(res.status).toBe(200);
  });

  it('is unavailable (503) when the control project is not configured', async () => {
    vi.stubEnv('CONTROL_SUPABASE_URL', '');
    const res = await updateConsoleSession(request('/console', SESSION));
    expect(res.status).toBe(503);
    expect(h.getSession).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const createServerClient = vi.fn();
const signOut = vi.fn();
vi.mock('@supabase/ssr', () => ({ createServerClient: (...a: unknown[]) => createServerClient(...a) }));
// The real module pulls in the company registry (server-only); only its cookie options are needed here.
vi.mock('@/lib/supabase/middleware', () => ({ lastSeenCookieOptions: { httpOnly: true, sameSite: 'lax', secure: false, path: '/' } }));

import { updateConsoleSession, CONSOLE_LAST_SEEN_COOKIE } from './middleware';

const ENV = {
  CONTROL_SUPABASE_URL: 'https://control-ref.supabase.co',
  NEXT_PUBLIC_CONTROL_ANON_KEY: 'anon',
  CONTROL_SERVICE_ROLE_KEY: 'service',
};

function request(path: string, cookie?: string) {
  const headers: Record<string, string> = { host: 'console.example.com', 'x-tenant': 'evil' };
  if (cookie) headers.cookie = cookie;
  return new NextRequest(`http://console.example.com${path}`, { headers });
}

const stale = `${CONSOLE_LAST_SEEN_COOKIE}=${Date.now() - 16 * 60_000}`;

beforeEach(() => {
  signOut.mockReset();
  createServerClient.mockReset();
  createServerClient.mockImplementation(() => ({ auth: { getUser: async () => ({ data: { user: { id: 'u' } } }), signOut } }));
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
});
afterEach(() => vi.unstubAllEnvs());

describe('updateConsoleSession', () => {
  it('does not forward a browser-sent x-tenant header', async () => {
    const res = await updateConsoleSession(request('/console'));
    expect(res.headers.get('x-middleware-request-x-tenant')).toBeNull();
  });

  it('allows only the control project in the CSP', async () => {
    const res = await updateConsoleSession(request('/console'));
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain('https://control-ref.supabase.co');
    expect(csp).not.toContain('academy');
  });

  it('signs out and redirects to the console login when idle', async () => {
    const res = await updateConsoleSession(request('/console/companies', stale));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.pathname + location.search).toBe('/console/login?reason=idle');
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(res.headers.get('set-cookie')).toContain(`${CONSOLE_LAST_SEEN_COOKIE}=;`);
  });

  it('does not redirect on the login page itself', async () => {
    const res = await updateConsoleSession(request('/console/login', stale));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('is unavailable (503) when the control project is not configured', async () => {
    vi.stubEnv('CONTROL_SUPABASE_URL', '');
    const res = await updateConsoleSession(request('/console'));
    expect(res.status).toBe(503);
    expect(createServerClient).not.toHaveBeenCalled();
  });
});

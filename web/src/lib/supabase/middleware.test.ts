import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const routeHost = vi.fn();
const createServerClient = vi.fn();
vi.mock('@/lib/tenant/route', () => ({ routeHost: (h: string | null) => routeHost(h) }));
vi.mock('@supabase/ssr', () => ({ createServerClient: (...a: unknown[]) => createServerClient(...a) }));

import { updateSession } from './middleware';

const tenant = { slug: 'academy', supabaseUrl: 'https://academy-ref.supabase.co', anonKey: 'anon' };

function request() {
  return new NextRequest('http://academy.example.com/patients', {
    headers: { host: 'academy.example.com', 'x-tenant': 'evil' },
  });
}

beforeEach(() => {
  routeHost.mockReset();
  createServerClient.mockReset();
  routeHost.mockResolvedValue({ kind: 'tenant', tenant });
  createServerClient.mockImplementation((_url: string, _key: string, opts: { cookies: { setAll: (c: unknown[]) => void } }) => ({
    auth: {
      getUser: async () => {
        opts.cookies.setAll([{ name: 'sb-token', value: 'v', options: {} }]);
        return { data: { user: null } };
      },
    },
  }));
});

describe('updateSession', () => {
  it.each([
    ['not-found', 404],
    ['suspended', 503],
    ['unavailable', 503],
  ] as const)('%s is blocked without touching Supabase', async (kind, status) => {
    routeHost.mockResolvedValue({ kind });
    const res = await updateSession(request());
    expect(res.status).toBe(status);
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it('forwards the trusted tenant slug, not a browser-sent one', async () => {
    createServerClient.mockImplementation(() => ({ auth: { getUser: async () => ({ data: { user: null } }) } }));
    const res = await updateSession(new NextRequest('http://academy.example.com/login', {
      headers: { host: 'academy.example.com', 'x-tenant': 'evil' },
    }));
    expect(res.headers.get('x-middleware-request-x-tenant')).toBe('academy');
  });

  it('keeps the trusted slug after a cookie refresh', async () => {
    const res = await updateSession(new NextRequest('http://academy.example.com/login', {
      headers: { host: 'academy.example.com', 'x-tenant': 'evil' },
    }));
    expect(res.headers.get('x-middleware-request-x-tenant')).not.toBe('evil');
    expect(res.headers.get('x-middleware-request-x-tenant')).toBe('academy');
    expect(res.headers.get('set-cookie')).toContain('sb-token=v');
  });

  it('redirects an unauthenticated protected request to login with the tenant CSP', async () => {
    const res = await updateSession(request());
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
    expect(res.headers.get('content-security-policy')).toContain('https://academy-ref.supabase.co');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
const h = vi.hoisted(() => ({ token: 'tok' as string | null, signOut: vi.fn() }));
vi.mock('@/lib/self-auth/cookie', () => ({ readSessionCookie: async () => h.token }));
vi.mock('@/lib/self-auth/console', () => ({ CONSOLE_COMPANY: 'console', consoleAuth: async () => ({ signOut: h.signOut }) }));

import { GET, POST } from './route';

beforeEach(() => {
  h.token = 'tok';
  h.signOut.mockReset();
});

describe('console sign-out', () => {
  it('GET ends the session, clears the cookies and redirects with the reason', async () => {
    const res = await GET(new NextRequest('http://console.example.com/console/signout?reason=not-admin'));
    expect(h.signOut).toHaveBeenCalledWith('tok');
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).search).toBe('?reason=not-admin');
    expect(res.headers.get('set-cookie')).toContain('icm_console_session=;');
    expect(res.headers.get('set-cookie')).toContain('icm_console_last_seen=;');
  });
  it('POST (the idle timer) answers 204 after ending the session', async () => {
    const res = await POST();
    expect(h.signOut).toHaveBeenCalledWith('tok');
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toContain('icm_console_session=;');
  });
  it('without a cookie there is nothing to end', async () => {
    h.token = null;
    const res = await POST();
    expect(h.signOut).not.toHaveBeenCalled();
    expect(res.status).toBe(204);
  });
});

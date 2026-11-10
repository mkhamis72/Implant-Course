import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('server-only', () => ({}));

const jar = { token: 'tok' as string | null };
const { del, clearSessionCookie, signOutSelfAuth } = vi.hoisted(() => ({
  del: vi.fn(),
  clearSessionCookie: vi.fn(async (..._a: unknown[]) => {}),
  signOutSelfAuth: vi.fn(async (..._a: unknown[]) => {}),
}));
vi.mock('@/lib/self-auth/cookie', () => ({ readSessionCookie: async () => jar.token, clearSessionCookie }));
vi.mock('@/lib/self-auth/tenant', () => ({ tenantAuth: async () => ({ signOut: signOutSelfAuth }) }));
vi.mock('next/headers', () => ({ cookies: async () => ({ delete: del }) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

import { signOut } from './auth';

beforeEach(() => {
  vi.clearAllMocks();
  jar.token = 'tok';
});

describe('signOut', () => {
  it('ends this session, clears both cookies and goes to sign-in', async () => {
    await expect(signOut()).rejects.toThrow('REDIRECT /login');
    expect(signOutSelfAuth).toHaveBeenCalledWith('tok');
    expect(clearSessionCookie).toHaveBeenCalledWith('tenant');
    expect(del).toHaveBeenCalledWith('icm_last_seen');
  });
  it('a failed revoke is an error and leaves the cookie', async () => {
    signOutSelfAuth.mockRejectedValueOnce(new Error('db down'));
    await expect(signOut()).rejects.toThrow('db down');
    expect(clearSessionCookie).not.toHaveBeenCalled();
  });
  it('without a cookie it still clears and redirects', async () => {
    jar.token = null;
    await expect(signOut()).rejects.toThrow('REDIRECT /login');
    expect(signOutSelfAuth).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: state.host }) }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

const state = {
  session: null as null | { userId: string; email: string; aal: 'aal1' | 'aal2' },
  hasTotp: false,
  listed: false,
  rpc: true,
  host: 'console.example.com:3000',
};
vi.mock('@/lib/self-auth/console-session', () => ({ currentConsoleSession: async () => state.session }));
vi.mock('@/lib/self-auth/console', () => ({ consoleAuth: async () => ({ totp: { hasTotp: async () => state.hasTotp } }) }));
vi.mock('./supabase', () => ({
  createConsoleClient: async () => ({ rpc: async () => ({ data: state.rpc }) }),
  createConsoleServiceClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.listed ? { active: true } : null }) }) }) }),
  }),
}));

import { requireConsoleAdmin, requireConsoleHost, requireConsoleUser } from './session';

const me = (aal: 'aal1' | 'aal2') => ({ userId: 'u1', email: 'a@b.c', aal });

beforeEach(() => {
  state.session = null;
  state.hasTotp = false;
  state.listed = true;
  state.rpc = true;
  state.host = 'console.example.com:3000';
  vi.stubEnv('CONSOLE_HOST', 'console.example.com');
});

describe('console host', () => {
  it('is a 404 on a company host, even for a signed-in admin', async () => {
    state.session = me('aal2');
    state.hasTotp = true;
    state.host = 'academy.example.com';
    await expect(requireConsoleAdmin()).rejects.toThrow('NOT_FOUND');
    await expect(requireConsoleUser()).rejects.toThrow('NOT_FOUND');
  });
  it('is a 404 when no console host is configured', async () => {
    vi.stubEnv('CONSOLE_HOST', '');
    await expect(requireConsoleHost()).rejects.toThrow('NOT_FOUND');
  });
});

describe('requireConsoleAdmin', () => {
  it('sends anonymous visitors to login', async () => {
    await expect(requireConsoleAdmin()).rejects.toThrow('REDIRECT /console/login');
  });
  it('signs out users who are not listed', async () => {
    state.session = me('aal2');
    state.hasTotp = true;
    state.listed = false;
    await expect(requireConsoleAdmin()).rejects.toThrow('REDIRECT /console/signout?reason=not-admin');
  });
  it('requires an authenticator to be set up (aal1, no factor)', async () => {
    state.session = me('aal1');
    await expect(requireConsoleAdmin()).rejects.toThrow('REDIRECT /console/mfa/setup');
  });
  it('requires the code at aal1 with a factor', async () => {
    state.session = me('aal1');
    state.hasTotp = true;
    await expect(requireConsoleAdmin()).rejects.toThrow('REDIRECT /console/login/mfa');
  });
  it('signs out when the control project disagrees', async () => {
    state.session = me('aal2');
    state.hasTotp = true;
    state.rpc = false;
    await expect(requireConsoleAdmin()).rejects.toThrow('REDIRECT /console/signout?reason=not-admin');
  });
  it('lets a listed aal2 admin in', async () => {
    state.session = me('aal2');
    state.hasTotp = true;
    await expect(requireConsoleAdmin()).resolves.toEqual({ userId: 'u1', email: 'a@b.c' });
  });
});

describe('requireConsoleUser', () => {
  it('accepts a listed user without a factor (MFA pages)', async () => {
    state.session = me('aal1');
    await expect(requireConsoleUser()).resolves.toEqual({ userId: 'u1', email: 'a@b.c' });
  });
});

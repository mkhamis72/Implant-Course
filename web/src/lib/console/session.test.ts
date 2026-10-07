import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

const state = {
  user: null as null | { id: string; email: string; factors: { status: string }[] },
  listed: false,
  aal: 'aal1',
  rpc: true,
};
vi.mock('./supabase', () => ({
  createConsoleClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user } }),
      getClaims: async () => ({ data: { claims: { aal: state.aal } } }),
    },
    rpc: async () => ({ data: state.rpc }),
  }),
  createConsoleServiceClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.listed ? { active: true } : null }) }) }) }),
  }),
}));

import { requireConsoleAdmin, requireConsoleUser } from './session';

const verified = [{ status: 'verified' }];
const me = (factors: { status: string }[]) => ({ id: 'u1', email: 'a@b.c', factors });

beforeEach(() => {
  state.user = null;
  state.listed = true;
  state.aal = 'aal1';
  state.rpc = true;
});

describe('requireConsoleAdmin', () => {
  it('sends anonymous visitors to login', async () => {
    await expect(requireConsoleAdmin()).rejects.toThrow('REDIRECT /console/login');
  });
  it('signs out users who are not listed', async () => {
    state.user = me(verified);
    state.listed = false;
    await expect(requireConsoleAdmin()).rejects.toThrow('REDIRECT /console/signout?reason=not-admin');
  });
  it('requires an authenticator to be set up', async () => {
    state.user = me([]);
    await expect(requireConsoleAdmin()).rejects.toThrow('REDIRECT /console/mfa/setup');
  });
  it('requires the code at aal1', async () => {
    state.user = me(verified);
    await expect(requireConsoleAdmin()).rejects.toThrow('REDIRECT /console/login/mfa');
  });
  it('signs out when the control project disagrees', async () => {
    state.user = me(verified);
    state.aal = 'aal2';
    state.rpc = false;
    await expect(requireConsoleAdmin()).rejects.toThrow('REDIRECT /console/signout?reason=not-admin');
  });
  it('lets a listed aal2 admin in', async () => {
    state.user = me(verified);
    state.aal = 'aal2';
    await expect(requireConsoleAdmin()).resolves.toEqual({ userId: 'u1', email: 'a@b.c' });
  });
});

describe('requireConsoleUser', () => {
  it('accepts a listed user without a factor (MFA pages)', async () => {
    state.user = me([]);
    await expect(requireConsoleUser()).resolves.toEqual({ userId: 'u1', email: 'a@b.c' });
  });
});

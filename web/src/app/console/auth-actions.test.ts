import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: vi.fn(), delete: vi.fn() }) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock('@/lib/console/session', () => ({ requireConsoleUser: async () => ({ userId: 'u1', email: 'a@b.c' }) }));

type Factor = { id: string; factor_type: string; status: string };
const state = { factors: [] as Factor[], listed: true };
const auth = {
  mfa: {
    listFactors: vi.fn(async () => ({ data: { all: state.factors, totp: state.factors.filter((f) => f.factor_type === 'totp') }, error: null })),
    enroll: vi.fn(async () => ({ data: { id: 'new', totp: { qr_code: 'q', secret: 's' } }, error: null })),
    unenroll: vi.fn(async () => ({ error: null })),
    challengeAndVerify: vi.fn(async () => ({ error: null })),
  },
  signInWithPassword: vi.fn(async () => ({ error: null })),
  getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } } })),
  signOut: vi.fn(async () => ({ error: null })),
};
vi.mock('@/lib/console/supabase', () => ({
  createConsoleClient: async () => ({ auth }),
  createConsoleServiceClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.listed ? { active: true } : null }) }) }) }),
  }),
}));

import { confirmConsoleEnroll, signInConsole, startConsoleEnroll } from './auth-actions';

beforeEach(() => {
  vi.clearAllMocks();
  state.factors = [];
  state.listed = true;
});

describe('startConsoleEnroll', () => {
  it('refuses when an authenticator is already verified', async () => {
    state.factors = [{ id: 'f1', factor_type: 'totp', status: 'verified' }];
    expect(await startConsoleEnroll()).toEqual({ error: 'An authenticator is already set up.' });
    expect(auth.mfa.enroll).not.toHaveBeenCalled();
  });
  it('enrols when none is verified', async () => {
    expect(await startConsoleEnroll()).toEqual({ factorId: 'new', qrCode: 'q', secret: 's' });
  });
});

describe('confirmConsoleEnroll', () => {
  it('refuses when an authenticator is already verified', async () => {
    state.factors = [{ id: 'f1', factor_type: 'totp', status: 'verified' }, { id: 'f2', factor_type: 'totp', status: 'unverified' }];
    expect(await confirmConsoleEnroll('f2', '123456')).toEqual({ error: 'An authenticator is already set up.' });
    expect(auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });
  it('refuses a factor that is not the user\'s unverified one', async () => {
    state.factors = [{ id: 'f2', factor_type: 'totp', status: 'unverified' }];
    expect(await confirmConsoleEnroll('other', '123456')).toEqual({ error: 'Start the setup again.' });
    expect(auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });
  it('verifies the user\'s own unverified factor', async () => {
    state.factors = [{ id: 'f2', factor_type: 'totp', status: 'unverified' }];
    expect(await confirmConsoleEnroll('f2', '123 456')).toEqual({ ok: true });
    expect(auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f2', code: '123456' });
  });
});

describe('signInConsole', () => {
  const form = () => {
    const fd = new FormData();
    fd.set('email', 'A@b.c');
    fd.set('password', 'pw');
    return fd;
  };
  it('answers like a wrong password and signs out when the user is not listed', async () => {
    state.listed = false;
    expect(await signInConsole({}, form())).toEqual({ error: 'Incorrect email or password.', email: 'a@b.c' });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('continues to the console when listed', async () => {
    await expect(signInConsole({}, form())).rejects.toThrow('REDIRECT /console');
  });
});

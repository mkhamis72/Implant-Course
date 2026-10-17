import { describe, it, expect, vi, beforeEach } from 'vitest';

const jar = { reset: undefined as string | undefined };
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name === 'icm_reset_pending' && jar.reset !== undefined ? { value: jar.reset } : undefined) }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
const auth = {
  mfa: {
    listFactors: vi.fn(async () => ({ data: { totp: [{ id: 'f1', status: 'verified' }] }, error: null })),
    challengeAndVerify: vi.fn(async () => ({ error: null as unknown })),
  },
};
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth }) }));

import { verifyMfa } from './actions';

const form = (code: string) => {
  const fd = new FormData();
  fd.set('code', code);
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
  jar.reset = undefined;
});

describe('verifyMfa', () => {
  it('goes home after a normal sign-in', async () => {
    await expect(verifyMfa({}, form('123 456'))).rejects.toThrow('REDIRECT /');
    expect(auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f1', code: '123456' });
  });
  it('continues to the new-password page after a reset link', async () => {
    jar.reset = '1';
    await expect(verifyMfa({}, form('123456'))).rejects.toThrow('REDIRECT /account/set-password');
  });
  it('stays on the form when the code is wrong', async () => {
    jar.reset = '1';
    auth.mfa.challengeAndVerify.mockResolvedValueOnce({ error: { code: 'mfa_verification_failed', message: 'x' } });
    expect(await verifyMfa({}, form('000000'))).toEqual({ error: 'That code is not correct. Check your authenticator app and try again.' });
  });
});

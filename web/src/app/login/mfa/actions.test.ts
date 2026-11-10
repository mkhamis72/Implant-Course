import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('server-only', () => ({}));

const jar = { token: 'tok' as string | null };
vi.mock('@/lib/self-auth/cookie', () => ({ readSessionCookie: async () => jar.token }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock('@/lib/tenant/current', () => ({ currentTenant: async () => ({ slug: 'academy', companyId: 'company-a' }) }));
const verify = vi.fn(async (..._a: unknown[]) => ({ aal: 'aal2' }) as unknown);
vi.mock('@/lib/self-auth/tenant', () => ({ tenantAuth: async () => ({ totp: { verify } }) }));

import { verifyMfa } from './actions';

const form = (code: string) => {
  const fd = new FormData();
  fd.set('code', code);
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
  jar.token = 'tok';
  verify.mockResolvedValue({ aal: 'aal2' });
});

describe('verifyMfa', () => {
  it("verifies the code for this session and host's company, then goes home", async () => {
    await expect(verifyMfa({}, form('123 456'))).rejects.toThrow('REDIRECT /');
    expect(verify).toHaveBeenCalledWith('tok', 'company-a', '123456');
  });
  it('a wrong code shows the existing message and stays', async () => {
    verify.mockResolvedValue(null);
    expect(await verifyMfa({}, form('000000'))).toEqual({
      error: 'That code is not correct. Check your authenticator app and try again.',
    });
  });
  it('without a session it goes back to sign-in', async () => {
    jar.token = null;
    await expect(verifyMfa({}, form('123456'))).rejects.toThrow('REDIRECT /login');
    expect(verify).not.toHaveBeenCalled();
  });
});

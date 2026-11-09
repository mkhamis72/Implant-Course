import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('server-only', () => ({}));

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock('@/lib/tenant/current', () => ({ currentTenant: async () => ({ slug: 'academy', companyId: 'company-a' }) }));
const resetPassword = vi.fn(async (_a: unknown) => ({ userId: 'u1', companyId: 'company-a' }) as unknown);
const acceptInvite = vi.fn(async (_a: unknown) => ({ userId: 'u1', companyId: 'company-a' }) as unknown);
vi.mock('@/lib/self-auth/tenant', () => ({ tenantAuth: async () => ({ resetPassword, acceptInvite }) }));

import { setPasswordFromLink } from './link-password';

const form = (over: Record<string, string> = {}) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ token: 'tkn', password: 'long-enough-1', confirm: 'long-enough-1', ...over })) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
  resetPassword.mockResolvedValue({ userId: 'u1', companyId: 'company-a' });
  acceptInvite.mockResolvedValue({ userId: 'u1', companyId: 'company-a' });
});

describe('setPasswordFromLink', () => {
  it('a reset sets the password and sends the user to sign in', async () => {
    await expect(setPasswordFromLink('reset', form())).rejects.toThrow('REDIRECT /login?notice=password_reset');
    expect(resetPassword).toHaveBeenCalledWith({ token: 'tkn', newPassword: 'long-enough-1' });
  });
  it('an invite accepts with the password', async () => {
    await expect(setPasswordFromLink('invite', form())).rejects.toThrow('REDIRECT /login?notice=invite_accepted');
    expect(acceptInvite).toHaveBeenCalledWith({ token: 'tkn', password: 'long-enough-1' });
  });
  it('a link for another company is "not valid here" (reset and invite)', async () => {
    resetPassword.mockResolvedValue({ userId: 'u9', companyId: 'company-b' });
    acceptInvite.mockResolvedValue({ userId: 'u9', companyId: 'company-b' });
    for (const kind of ['reset', 'invite'] as const) {
      expect(await setPasswordFromLink(kind, form())).toEqual({
        error: 'This link is not valid here. Open the link from your email on the address it was sent for.',
      });
    }
  });
  it('a used or expired link is reported without redirecting', async () => {
    resetPassword.mockResolvedValue(null);
    acceptInvite.mockResolvedValue(null);
    expect(await setPasswordFromLink('reset', form())).toEqual({ error: expect.stringMatching(/invalid or has expired/) });
    expect(await setPasswordFromLink('invite', form())).toEqual({ error: expect.stringMatching(/invalid or has expired/) });
  });
  it('checks length and match before using the link up', async () => {
    expect(await setPasswordFromLink('reset', form({ password: 'short', confirm: 'short' }))).toEqual({ error: 'Use at least 10 characters.' });
    expect(await setPasswordFromLink('reset', form({ confirm: 'different-123' }))).toEqual({ error: 'The passwords do not match.' });
    expect(resetPassword).not.toHaveBeenCalled();
  });
  it('a missing token goes to the link error page', async () => {
    await expect(setPasswordFromLink('reset', form({ token: '' }))).rejects.toThrow('REDIRECT /auth/error?code=missing_token');
  });
  it('an unexpected failure shows the generic message', async () => {
    resetPassword.mockRejectedValueOnce(new Error('db'));
    expect(await setPasswordFromLink('reset', form())).toEqual({ error: 'Something went wrong. Please try again.' });
  });
});

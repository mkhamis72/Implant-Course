import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock('@/lib/console/session', () => ({ requireConsoleHost: async () => undefined }));
const resetPassword = vi.fn();
vi.mock('@/lib/self-auth/console', () => ({ CONSOLE_COMPANY: 'console', consoleAuth: async () => ({ resetPassword }) }));

import { resetConsolePassword } from './actions';

const form = (token: string, password: string, confirm: string) => {
  const fd = new FormData();
  fd.set('token', token);
  fd.set('password', password);
  fd.set('confirm', confirm);
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
  resetPassword.mockResolvedValue({ userId: 'u', companyId: 'console' });
});

describe('resetConsolePassword', () => {
  it('sets the password and sends the admin to sign in', async () => {
    await expect(resetConsolePassword({}, form('T', 'a-new-password-1', 'a-new-password-1'))).rejects.toThrow('REDIRECT /console/login?notice=password_reset');
    expect(resetPassword).toHaveBeenCalledWith({ token: 'T', newPassword: 'a-new-password-1' });
  });
  it('refuses a short password and a mismatch without spending the token', async () => {
    expect(await resetConsolePassword({}, form('T', 'short', 'short'))).toEqual({ error: 'Use at least 10 characters.' });
    expect(await resetConsolePassword({}, form('T', 'a-new-password-1', 'a-new-password-2'))).toEqual({ error: 'The passwords do not match.' });
    expect(resetPassword).not.toHaveBeenCalled();
  });
  it('says the link is invalid when Self-Auth refuses it', async () => {
    resetPassword.mockResolvedValue(null);
    expect((await resetConsolePassword({}, form('T', 'a-new-password-1', 'a-new-password-1'))).error).toMatch(/invalid or has expired/);
  });
  it('treats a link from a company as not valid here', async () => {
    resetPassword.mockResolvedValue({ userId: 'u', companyId: 'acme' });
    const r = await resetConsolePassword({}, form('T', 'a-new-password-1', 'a-new-password-1'));
    expect(r.error).toBeTruthy();
  });
});

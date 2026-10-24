import { describe, it, expect, vi, beforeEach } from 'vitest';

const del = vi.fn();
vi.mock('next/headers', () => ({ cookies: async () => ({ delete: del }) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
const requireSignedIn = vi.hoisted(() => vi.fn<(options?: { allowMfaSetup?: boolean }) => Promise<object>>(async () => ({})));
vi.mock('@/lib/auth/session', () => ({ requireSignedIn }));
const auth = { updateUser: vi.fn(async () => ({ error: null as unknown })) };
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth }) }));

import { setPassword } from './actions';
import SetPasswordPage from './page';

const form = (password: string, confirm = password) => {
  const fd = new FormData();
  fd.set('password', password);
  fd.set('confirm', confirm);
  return fd;
};

beforeEach(() => vi.clearAllMocks());

describe('setPassword', () => {
  it('saves the password, ends a pending reset and goes home', async () => {
    await expect(setPassword({}, form('long-enough-1'))).rejects.toThrow('REDIRECT /');
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'long-enough-1' });
    expect(del).toHaveBeenCalledWith('icm_reset_pending');
  });
  it('keeps the reset pending when saving fails', async () => {
    auth.updateUser.mockResolvedValueOnce({ error: { code: 'same_password', message: 'x' } });
    expect(await setPassword({}, form('long-enough-1'))).toEqual({ error: 'Choose a password different from your current one.' });
    expect(del).not.toHaveBeenCalled();
  });
  it('checks length and match before calling Supabase', async () => {
    expect(await setPassword({}, form('short'))).toEqual({ error: 'Use at least 10 characters.' });
    expect(await setPassword({}, form('long-enough-1', 'long-enough-2'))).toEqual({ error: 'The passwords do not match.' });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it("stays open while an admin's 2FA reset requires set-up again", async () => {
    await expect(setPassword({}, form('long-enough-1'))).rejects.toThrow('REDIRECT /');
    expect(requireSignedIn).toHaveBeenCalledWith({ allowMfaSetup: true });
  });
});

describe('SetPasswordPage', () => {
  it("stays open while an admin's 2FA reset requires set-up again", async () => {
    await SetPasswordPage();
    expect(requireSignedIn).toHaveBeenCalledWith({ allowMfaSetup: true });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
const guard = vi.fn(async () => ({ userId: 'u1', email: 'owner@example.com' }));
vi.mock('@/lib/console/session', () => ({ requireConsoleAdmin: () => guard() }));
const updateUser = vi.fn<(attrs: { password: string }) => Promise<{ error: null | { message: string; code?: string } }>>(async () => ({ error: null }));
vi.mock('@/lib/console/supabase', () => ({ createConsoleClient: async () => ({ auth: { updateUser } }) }));

import { changeConsolePassword } from './actions';

const form = (password: string, confirm: string) => {
  const fd = new FormData();
  fd.set('password', password);
  fd.set('confirm', confirm);
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('changeConsolePassword', () => {
  it('checks the console admin first', async () => {
    guard.mockRejectedValueOnce(new Error('REDIRECT /console/login'));
    await expect(changeConsolePassword({}, form('long-enough-pw', 'long-enough-pw'))).rejects.toThrow('REDIRECT /console/login');
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('refuses a short password and a mismatch without saving', async () => {
    expect(await changeConsolePassword({}, form('short', 'short'))).toEqual({ error: 'Use at least 10 characters.' });
    expect(await changeConsolePassword({}, form('long-enough-pw', 'long-enough-px'))).toEqual({ error: 'The passwords do not match.' });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('sets the new password on the console login', async () => {
    expect(await changeConsolePassword({}, form('a-new-password-1', 'a-new-password-1'))).toEqual({ ok: 'Password changed.' });
    expect(updateUser).toHaveBeenCalledWith({ password: 'a-new-password-1' });
  });

  it('shows the Auth error when the change is refused', async () => {
    updateUser.mockResolvedValueOnce({ error: { message: 'New password should be different from the old password.', code: 'same_password' } });
    expect(await changeConsolePassword({}, form('a-new-password-1', 'a-new-password-1'))).toEqual({
      error: 'Choose a password different from your current one.',
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const env = { emailOn: true };
vi.mock('@/lib/flags', () => ({ emailEnabled: () => env.emailOn }));
vi.mock('@/lib/tenant/current', () => ({ requestOrigin: async () => 'https://kaleidoscope.imploid.net' }));
const auth = { resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null as unknown })) };
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth }) }));

import { requestReset } from './actions';
import { FORGOT_SENT, FORGOT_TOO_MANY } from '@/lib/auth/password-reset';

const form = (email: string) => {
  const fd = new FormData();
  fd.set('email', email);
  return fd;
};

beforeEach(() => {
  vi.clearAllMocks();
  env.emailOn = true;
});

describe('requestReset', () => {
  it('sends the reset email with a link back to this site', async () => {
    expect(await requestReset({}, form('  Someone@Example.com '))).toEqual({ sent: FORGOT_SENT });
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('someone@example.com', {
      redirectTo: 'https://kaleidoscope.imploid.net/auth/confirm',
    });
  });
  it('replies the same when Supabase reports an error', async () => {
    auth.resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: { code: 'unexpected_failure', message: 'boom' } });
    expect(await requestReset({}, form('nobody@example.com'))).toEqual({ sent: FORGOT_SENT });
  });
  it('reports rate limiting as an error, keeping the address', async () => {
    auth.resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: { code: 'over_email_send_rate_limit', message: 'x' } });
    expect(await requestReset({}, form('a@b.co'))).toEqual({ error: FORGOT_TOO_MANY, email: 'a@b.co' });
  });
  it('refuses an empty or malformed address without calling Supabase', async () => {
    expect(await requestReset({}, form('   '))).toEqual({ error: 'Enter your email address.', email: '' });
    expect(await requestReset({}, form('not-an-email'))).toEqual({ error: 'Enter your email address.', email: 'not-an-email' });
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });
  it('sends nothing while email is off', async () => {
    env.emailOn = false;
    expect(await requestReset({}, form('a@b.co'))).toEqual({ error: 'Password reset by email is not available. Ask an admin to reset your password.' });
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

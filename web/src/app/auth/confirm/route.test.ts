import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const set = vi.fn();
vi.mock('next/headers', () => ({ cookies: async () => ({ set }) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
const auth = { verifyOtp: vi.fn(async () => ({ error: null as unknown })) };
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth }) }));

import { GET } from './route';

const get = (query: string) => GET(new NextRequest(`http://localhost:3000/auth/confirm?${query}`));

beforeEach(() => vi.clearAllMocks());

describe('GET /auth/confirm', () => {
  it('a reset link marks the reset as pending and opens the new-password page', async () => {
    await expect(get('token_hash=h&type=recovery')).rejects.toThrow('REDIRECT /account/set-password');
    expect(set).toHaveBeenCalledWith('icm_reset_pending', '1', expect.objectContaining({ httpOnly: true, maxAge: 900 }));
  });
  it('an invite opens the new-password page without the reset mark', async () => {
    await expect(get('token_hash=h&type=invite')).rejects.toThrow('REDIRECT /account/set-password');
    expect(set).not.toHaveBeenCalled();
  });
  it('a failed reset link sets nothing', async () => {
    auth.verifyOtp.mockResolvedValueOnce({ error: { code: 'otp_expired', message: 'x' } });
    await expect(get('token_hash=h&type=recovery')).rejects.toThrow('REDIRECT /auth/error?code=otp_expired');
    expect(set).not.toHaveBeenCalled();
  });
});

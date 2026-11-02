import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const set = vi.fn();
vi.mock('next/headers', () => ({ cookies: async () => ({ set }) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
const auth = { verifyOtp: vi.fn(async () => ({ error: null as unknown })), signOut: vi.fn(async () => ({ error: null })) };
const rpc = vi.fn<(name: string, args: unknown) => Promise<{ data: null; error: unknown }>>(async () => ({ data: null, error: null }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth, rpc }) }));
vi.mock('@/lib/tenant/current', () => ({ currentTenant: async () => ({ slug: 'academy', companyId: 'company-a' }) }));

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
  it("binds the new session to this host's company", async () => {
    await expect(get('token_hash=h&type=invite')).rejects.toThrow('REDIRECT /account/set-password');
    expect(rpc).toHaveBeenCalledWith('bind_my_session', { p_company: 'company-a' });
  });
  it("a link opened on a company the user doesn't belong to is refused and signed out", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'You do not have access to this company.', hint: 'user' } });
    await expect(get('token_hash=h&type=recovery')).rejects.toThrow('REDIRECT /auth/error?code=company');
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(set).not.toHaveBeenCalled();
  });
  it('a failed bind that is not a refusal opens the generic error page and keeps the session', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'connection reset' } });
    await expect(get('token_hash=h&type=recovery')).rejects.toThrow('REDIRECT /auth/error?code=unexpected');
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });
});

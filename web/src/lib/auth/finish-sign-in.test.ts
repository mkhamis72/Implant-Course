import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('server-only', () => ({}));

const A = 'a7c0de00-0000-4000-8000-000000000001';
const { state, eq, setSessionCookie, lastSeen, rpc, forSession, signOut } = vi.hoisted(() => ({
  state: { bindError: null as unknown, role: 'organizer' as string | null },
  eq: vi.fn(),
  setSessionCookie: vi.fn(async (..._a: unknown[]) => {}),
  lastSeen: vi.fn(),
  rpc: vi.fn(async (_n: string, _a: unknown): Promise<{ data: null; error: unknown }> => ({ data: null, error: null })),
  forSession: vi.fn(),
  signOut: vi.fn(async (_: string) => {}),
}));
vi.mock('@/lib/self-auth/cookie', () => ({ readSessionCookie: async () => 'tok', setSessionCookie, clearSessionCookie: vi.fn(async () => {}) }));
vi.mock('@/lib/self-auth/tenant', () => ({ tenantAuth: async () => ({ signOut }) }));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: lastSeen }) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createClientForSession: async (session: unknown) => {
    forSession(session);
    const chain = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        eq(col, val);
        return chain;
      },
      maybeSingle: async () => ({ data: state.role ? { role: state.role } : null, error: null }),
    };
    return { rpc, from: () => chain };
  },
}));

import { finishSignIn } from './finish-sign-in';

const session = { sessionId: 's1', userId: 'u1', companyId: A, email: 'u@example.com', aal: 'aal1', expiresAt: new Date(Date.now() + 3600_000) } as never;
const run = (needsTotp = false) => finishSignIn({ companyId: A, sessionToken: 'new-token', session, needsTotp });

beforeEach(() => {
  vi.clearAllMocks();
  state.bindError = null;
  state.role = 'organizer';
  rpc.mockImplementation(async () => ({ data: null, error: state.bindError }));
});

describe('finishSignIn', () => {
  it('finish_sign_in_sets_cookie_binds_and_redirects_home', async () => {
    await expect(run()).rejects.toThrow(/^REDIRECT \/$/);
    const [kind, token, maxAge] = setSessionCookie.mock.calls[0] as [string, string, number];
    expect([kind, token]).toEqual(['tenant', 'new-token']);
    expect(maxAge).toBeGreaterThan(3500);
    expect(maxAge).toBeLessThanOrEqual(3600);
    expect(forSession).toHaveBeenCalledWith(session);
    expect(rpc).toHaveBeenCalledWith('bind_my_session', { p_company: A });
    expect(lastSeen).toHaveBeenCalledWith('icm_last_seen', expect.any(String), expect.anything());
  });
  it('finish_sign_in_refused_binding_returns_company_message', async () => {
    state.bindError = { message: 'You do not have access to this company.', hint: 'user' };
    expect(await run()).toEqual({ error: 'You do not have access to this company.', code: 'company' });
    expect(signOut).toHaveBeenCalledWith('tok');
    expect(lastSeen).not.toHaveBeenCalled();
  });
  it('finish_sign_in_outage_returns_generic_message_and_keeps_session', async () => {
    state.bindError = { message: 'connection reset' };
    expect(await run()).toEqual({ error: 'Something went wrong. Please try again.', code: 'unavailable' });
    expect(signOut).not.toHaveBeenCalled();
  });
  it('finish_sign_in_mfa_redirect_after_membership_check', async () => {
    await expect(run(true)).rejects.toThrow('REDIRECT /login/mfa');
    expect(rpc).toHaveBeenCalled();
  });
  it('finish_sign_in_delegate_goes_to_my', async () => {
    state.role = 'delegate';
    await expect(run()).rejects.toThrow('REDIRECT /my');
    expect(eq).toHaveBeenCalledWith('company_id', A);
    expect(eq).toHaveBeenCalledWith('user_id', 'u1');
  });
});

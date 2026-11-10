import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('server-only', () => ({}));

const A = 'a7c0de00-0000-4000-8000-000000000001';
const { state, eq } = vi.hoisted(() => ({
  state: {
    bindError: null as unknown,
    role: 'organizer' as string | null,
    result: null as unknown,
  },
  eq: vi.fn(),
}));
const { signIn, signOut, setSessionCookie, clearSessionCookie, lastSeen, rpc, forSession } = vi.hoisted(() => ({
  signIn: vi.fn(async (_: unknown): Promise<unknown> => null),
  signOut: vi.fn(async (_: string) => {}),
  setSessionCookie: vi.fn(async (..._a: unknown[]) => {}),
  clearSessionCookie: vi.fn(async (..._a: unknown[]) => {}),
  lastSeen: vi.fn(),
  rpc: vi.fn(async (_n: string, _a: unknown): Promise<{ data: null; error: unknown }> => ({ data: null, error: null })),
  forSession: vi.fn(),
}));
vi.mock('@/lib/self-auth/cookie', () => ({ readSessionCookie: async () => 'tok', setSessionCookie, clearSessionCookie }));
vi.mock('@/lib/self-auth/tenant', () => ({ tenantAuth: async () => ({ signIn, signOut }) }));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: lastSeen }) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock('@/lib/tenant/current', () => ({ currentTenant: async () => ({ slug: 'academy', companyId: A }) }));
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
    return {
      rpc,
      from: (table: string) => {
        if (table !== 'company_members') throw new Error(`unexpected table ${table}`);
        return chain;
      },
    };
  },
}));

import { login } from './actions';

const session = { sessionId: 's1', userId: 'u1', companyId: A, email: 'u@example.com', aal: 'aal1', expiresAt: new Date(Date.now() + 3600_000) };
const ok = (needsTotp = false) => ({ ok: true, sessionToken: 'new-token', session, needsTotp });

const form = () => {
  const f = new FormData();
  f.set('email', 'U@Example.com');
  f.set('password', 'pw');
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  state.bindError = null;
  state.role = 'organizer';
  state.result = ok();
  signIn.mockImplementation(async () => state.result);
  rpc.mockImplementation(async () => ({ data: null, error: state.bindError }));
});

describe('login', () => {
  it("signs in with this host's company and the lowercased email", async () => {
    await expect(login({}, form())).rejects.toThrow(/^REDIRECT \/$/);
    expect(signIn).toHaveBeenCalledWith({ companyId: A, email: 'u@example.com', password: 'pw' });
  });
  it('sets the session cookie for the session lifetime and binds the new session to the company', async () => {
    await expect(login({}, form())).rejects.toThrow('REDIRECT');
    const [kind, token, maxAge] = setSessionCookie.mock.calls[0] as [string, string, number];
    expect([kind, token]).toEqual(['tenant', 'new-token']);
    expect(maxAge).toBeGreaterThan(3500);
    expect(maxAge).toBeLessThanOrEqual(3600);
    expect(forSession).toHaveBeenCalledWith(session);
    expect(rpc).toHaveBeenCalledWith('bind_my_session', { p_company: A });
    expect(lastSeen).toHaveBeenCalledWith('icm_last_seen', expect.any(String), expect.anything());
  });
  it('wrong credentials show the existing message and keep the email, setting no cookie', async () => {
    state.result = { ok: false, reason: 'invalid_credentials' };
    expect(await login({}, form())).toEqual({ error: 'Incorrect email or password.', email: 'u@example.com' });
    expect(setSessionCookie).not.toHaveBeenCalled();
  });
  it('a disabled account gets the deactivated message', async () => {
    state.result = { ok: false, reason: 'disabled' };
    expect(await login({}, form())).toEqual({ error: 'This account has been deactivated. Contact an admin.', email: 'u@example.com' });
  });
  it('a locked account says to wait', async () => {
    state.result = { ok: false, reason: 'locked' };
    expect(await login({}, form())).toEqual({ error: 'Too many failed attempts. Try again in 15 minutes.', email: 'u@example.com' });
  });
  it('a session the company refuses is ended and the cookie cleared', async () => {
    state.bindError = { message: 'You do not have access to this company.', hint: 'user' };
    expect(await login({}, form())).toEqual({ error: 'You do not have access to this company.', email: 'u@example.com' });
    expect(signOut).toHaveBeenCalledWith('tok');
    expect(clearSessionCookie).toHaveBeenCalledWith('tenant');
  });
  it('a failed bind that is not a refusal shows the generic message and keeps the session', async () => {
    state.bindError = { message: 'connection reset' };
    expect(await login({}, form())).toEqual({ error: 'Something went wrong. Please try again.', email: 'u@example.com' });
    expect(signOut).not.toHaveBeenCalled();
  });
  it("a delegate member goes to /my, reading the role from this company's member row", async () => {
    state.role = 'delegate';
    await expect(login({}, form())).rejects.toThrow('REDIRECT /my');
    expect(eq).toHaveBeenCalledWith('company_id', A);
    expect(eq).toHaveBeenCalledWith('user_id', 'u1');
  });
  it('a user with an authenticator goes to the code page (after the membership check)', async () => {
    state.result = ok(true);
    await expect(login({}, form())).rejects.toThrow('REDIRECT /login/mfa');
    expect(rpc).toHaveBeenCalled();
  });
  it('a 2FA user who is not a member is refused before the code page', async () => {
    state.result = ok(true);
    state.bindError = { message: 'You do not have access to this company.', hint: 'user' };
    expect(await login({}, form())).toMatchObject({ error: 'You do not have access to this company.' });
  });
});

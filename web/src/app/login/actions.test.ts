import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('server-only', () => ({}));

const A = 'a7c0de00-0000-4000-8000-000000000001';
const { state, eq } = vi.hoisted(() => ({
  state: { bindError: null as unknown, role: 'organizer' as string | null, factors: [] as { status: string }[] },
  eq: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: vi.fn() }) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock('@/lib/tenant/current', () => ({ currentTenant: async () => ({ slug: 'academy', companyId: A }) }));
const signOut = vi.fn(async () => ({ error: null }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    const chain = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        eq(col, val);
        return chain;
      },
      maybeSingle: async () => ({ data: state.role ? { role: state.role } : null, error: null }),
    };
    return {
      auth: {
        signInWithPassword: async () => ({ data: { user: { id: 'u1', factors: state.factors } }, error: null }),
        signOut,
      },
      rpc: async () => ({ data: null, error: state.bindError }),
      from: (table: string) => {
        if (table !== 'company_members') throw new Error(`unexpected table ${table}`);
        return chain;
      },
    };
  },
}));

import { login } from './actions';

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
  state.factors = [];
});

describe('login', () => {
  it('a user who is not a member of this company is refused and signed out', async () => {
    state.bindError = { message: 'You do not have access to this company.', hint: 'user' };
    expect(await login({}, form())).toEqual({ error: 'You do not have access to this company.', email: 'u@example.com' });
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('a failed bind that is not a refusal shows the generic message, not the refusal', async () => {
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
  it('staff go to the dashboard', async () => {
    await expect(login({}, form())).rejects.toThrow(/^REDIRECT \/$/);
  });
  it('a 2FA user who is not a member is refused before the code page', async () => {
    state.factors = [{ status: 'verified' }];
    state.bindError = { message: 'You do not have access to this company.', hint: 'user' };
    expect(await login({}, form())).toMatchObject({ error: 'You do not have access to this company.' });
  });
});

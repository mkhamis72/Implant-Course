import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('server-only', () => ({}));

const A = 'a7c0de00-0000-4000-8000-000000000001';
const { row, session, calls } = vi.hoisted(() => ({
  row: { current: null as Record<string, unknown> | null },
  session: { bound: null as string | null, bindError: null as unknown },
  calls: { eq: [] as [string, string, unknown][], signOut: 0 },
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock('@/lib/tenant/current', () => ({ currentTenant: async () => ({ slug: 'academy', companyId: A }) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    const from = (table: string) => {
      const r = row.current;
      const result =
        table === 'company_members'
          ? {
              data: r && {
                role: r.role, active: r.active, delegate_id: r.delegate_id, mfa_setup_required: r.mfa_setup_required,
                profile: { full_name: r.full_name, email: r.email },
              },
              error: null,
            }
          : { data: (r?.permissions as unknown[]) ?? [], error: null };
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          calls.eq.push([table, col, val]);
          return chain;
        },
        maybeSingle: async () => result,
        then: (resolve: (v: typeof result) => unknown) => resolve(result),
      };
      return chain;
    };
    const rpc = async (name: string) =>
      name === 'my_session_company' ? { data: session.bound, error: null } : { data: null, error: session.bindError };
    const signOut = async () => {
      calls.signOut++;
      return { error: null };
    };
    return { auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'u@example.com' } } }), signOut }, rpc, from };
  },
}));
import {
  checkPermission, getCurrentProfile, requireActiveUser, requireAdmin, requireDelegate, requirePermission, requireSignedIn,
} from './session';

const profile = (over: Record<string, unknown> = {}) => ({
  user_id: 'u1', full_name: 'U', email: 'u@example.com', role: 'admin', active: true, delegate_id: null,
  mfa_setup_required: false, permissions: [], ...over,
});

beforeEach(() => {
  row.current = profile();
  session.bound = A;
  session.bindError = null;
  calls.eq = [];
  calls.signOut = 0;
});

describe("the session's company", () => {
  it("reads role and flags from this company's member row, and permissions for this company", async () => {
    row.current = profile({ role: 'delegate', delegate_id: 'd1', permissions: [{ area: 'patients', level: 'view' }] });
    expect(await getCurrentProfile()).toEqual({
      user_id: 'u1', full_name: 'U', email: 'u@example.com', role: 'delegate', active: true, delegate_id: 'd1',
      mfa_setup_required: false, permissions: { patients: 'view' },
    });
    expect(calls.eq).toEqual(expect.arrayContaining([
      ['company_members', 'company_id', A], ['company_members', 'user_id', 'u1'],
      ['user_permissions', 'company_id', A], ['user_permissions', 'user_id', 'u1'],
    ]));
  });
  it('an unbound session is bound on its first request', async () => {
    session.bound = null;
    await expect(getCurrentProfile()).resolves.toMatchObject({ role: 'admin', active: true });
    expect(calls.signOut).toBe(0);
  });
  it('a session bound to another company reads as signed out, and the guards send it to sign in with the reason', async () => {
    session.bound = 'b0000000-0000-4000-8000-0000000000b2';
    expect(await getCurrentProfile()).toBeNull();
    expect(calls.signOut).toBeGreaterThan(0);
    await expect(requireSignedIn()).rejects.toThrow('REDIRECT /login?error=company');
  });
  it('an unbound session that cannot be bound reads as signed out', async () => {
    session.bound = null;
    session.bindError = { message: 'You do not have access to this company.' };
    expect(await getCurrentProfile()).toBeNull();
    await expect(requireSignedIn()).rejects.toThrow('REDIRECT /login?error=company');
  });
  it('a member deactivated in this company is signed out with the reason', async () => {
    row.current = profile({ active: false });
    expect(await getCurrentProfile()).toBeNull();
    expect(calls.signOut).toBeGreaterThan(0);
    await expect(requireSignedIn()).rejects.toThrow('REDIRECT /login?error=company');
  });
  it('no member row keeps the "deactivated" fallback', async () => {
    row.current = null;
    await expect(getCurrentProfile()).resolves.toMatchObject({ user_id: 'u1', active: false });
    await expect(requireSignedIn()).rejects.toThrow('REDIRECT /deactivated');
  });
});

describe('while two-factor set-up is required', () => {
  beforeEach(() => {
    row.current = profile({ mfa_setup_required: true });
  });
  it.each([
    ['requireAdmin', () => requireAdmin()],
    ['requireSignedIn', () => requireSignedIn()],
    ['requireActiveUser', () => requireActiveUser()],
    ['requirePermission', () => requirePermission('patients')],
  ])('%s sends the user to Account → Security', async (_name, guard) => {
    await expect(guard()).rejects.toThrow('REDIRECT /account/security');
  });
  it('requireDelegate does too', async () => {
    row.current = profile({ role: 'delegate', mfa_setup_required: true });
    await expect(requireDelegate()).rejects.toThrow('REDIRECT /account/security');
  });
  it('checkPermission returns the message instead of redirecting', async () => {
    expect(await checkPermission('patients')).toBe('Set up two-factor authentication first.');
  });
  it('the security page itself is still allowed', async () => {
    await expect(requireSignedIn({ allowMfaSetup: true })).resolves.toMatchObject({ user_id: 'u1', mfa_setup_required: true });
  });
  it('a deactivated account is still signed out first', async () => {
    row.current = profile({ mfa_setup_required: true, active: false });
    await expect(requireSignedIn()).rejects.toThrow('REDIRECT /login?error=company');
  });
});

describe('without the flag', () => {
  it('lets an admin through', async () => {
    await expect(requireAdmin()).resolves.toMatchObject({ user_id: 'u1', mfa_setup_required: false });
    expect(await checkPermission('patients')).toBeNull();
  });
});

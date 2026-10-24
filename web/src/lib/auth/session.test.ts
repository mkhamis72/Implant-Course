import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('server-only', () => ({}));

const { row } = vi.hoisted(() => ({ row: { current: null as Record<string, unknown> | null } }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: row.current, error: null }) };
    return { auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'u@example.com' } } }) }, from: () => chain };
  },
}));
import {
  checkPermission, requireActiveUser, requireAdmin, requireDelegate, requirePermission, requireSignedIn,
} from './session';

const profile = (over: Record<string, unknown> = {}) => ({
  user_id: 'u1', full_name: 'U', email: 'u@example.com', role: 'admin', active: true, delegate_id: null,
  mfa_setup_required: false, permissions: [], ...over,
});

beforeEach(() => {
  row.current = profile();
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
  it('a deactivated account still goes to /deactivated first', async () => {
    row.current = profile({ mfa_setup_required: true, active: false });
    await expect(requireSignedIn()).rejects.toThrow('REDIRECT /deactivated');
  });
});

describe('without the flag', () => {
  it('lets an admin through', async () => {
    await expect(requireAdmin()).resolves.toMatchObject({ user_id: 'u1', mfa_setup_required: false });
    expect(await checkPermission('patients')).toBeNull();
  });
});

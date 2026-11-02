import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('server-only', () => ({}));

const { admin } = vi.hoisted(() => ({
  admin: {
    getUserById: vi.fn(),
    updateUserById: vi.fn(),
    listUsers: vi.fn(),
    generateLink: vi.fn(),
    mfa: { listFactors: vi.fn(), deleteFactor: vi.fn() },
  },
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(async () => ({ auth: { admin } })) }));
vi.mock('@/lib/tenant/current', () => ({ requestOrigin: vi.fn(async () => 'https://academy.example.com') }));
import { changeAuthEmail, hasVerifiedFactor, inviteLink, listSignIns, resetAuthFactors } from './auth-accounts';

beforeEach(() => vi.clearAllMocks());

const user = (over: Record<string, unknown> = {}) => ({
  data: { user: { id: 'u1', email: 'old@example.com', last_sign_in_at: '2026-10-01T08:00:00Z', email_confirmed_at: '2026-09-01T08:00:00Z', ...over } },
  error: null,
});

describe('changeAuthEmail', () => {
  it('sets the new address as confirmed and returns the account as it was', async () => {
    admin.getUserById.mockResolvedValue(user());
    admin.updateUserById.mockResolvedValue({ data: {}, error: null });
    expect(await changeAuthEmail('u1', 'new@example.com')).toEqual({ previous: { email: 'old@example.com', signedInBefore: true } });
    expect(admin.updateUserById).toHaveBeenCalledWith('u1', { email: 'new@example.com', email_confirm: true });
  });
  it('reports a never-signed-in account', async () => {
    admin.getUserById.mockResolvedValue(user({ last_sign_in_at: null }));
    admin.updateUserById.mockResolvedValue({ data: {}, error: null });
    expect(await changeAuthEmail('u1', 'new@example.com')).toEqual({ previous: { email: 'old@example.com', signedInBefore: false } });
  });
  it('leaves a never-confirmed invite unconfirmed, so the invite can still be resent', async () => {
    admin.getUserById.mockResolvedValue(user({ last_sign_in_at: null, email_confirmed_at: null }));
    admin.updateUserById.mockResolvedValue({ data: {}, error: null });
    expect(await changeAuthEmail('u1', 'fixed@example.com')).toEqual({ previous: { email: 'old@example.com', signedInBefore: false } });
    expect(admin.updateUserById).toHaveBeenCalledWith('u1', { email: 'fixed@example.com' });
  });
  it('refuses an address another account uses', async () => {
    admin.getUserById.mockResolvedValue(user());
    admin.updateUserById.mockResolvedValue({ data: null, error: { code: 'email_exists', message: 'exists', status: 422 } });
    expect(await changeAuthEmail('u1', 'taken@example.com')).toEqual({ error: 'Another account already uses that email.' });
  });
  it('refuses the address they already have, without touching Auth', async () => {
    admin.getUserById.mockResolvedValue(user());
    expect(await changeAuthEmail('u1', 'old@example.com')).toEqual({ error: 'That is already their sign-in email.' });
    expect(admin.updateUserById).not.toHaveBeenCalled();
  });
});

describe('resetAuthFactors', () => {
  it('deletes every factor, verified or not', async () => {
    admin.mfa.listFactors.mockResolvedValue({ data: { factors: [{ id: 'f1', status: 'verified' }, { id: 'f2', status: 'unverified' }] }, error: null });
    admin.mfa.deleteFactor.mockResolvedValue({ data: {}, error: null });
    expect(await resetAuthFactors('u1')).toBeNull();
    expect(admin.mfa.listFactors).toHaveBeenCalledWith({ userId: 'u1' });
    expect(admin.mfa.deleteFactor).toHaveBeenCalledWith({ id: 'f1', userId: 'u1' });
    expect(admin.mfa.deleteFactor).toHaveBeenCalledWith({ id: 'f2', userId: 'u1' });
  });
  it('deletes leftover unverified factors on a retry (the action decides whether a reset is allowed)', async () => {
    admin.mfa.listFactors.mockResolvedValue({ data: { factors: [{ id: 'f2', status: 'unverified' }] }, error: null });
    admin.mfa.deleteFactor.mockResolvedValue({ data: {}, error: null });
    expect(await resetAuthFactors('u1')).toBeNull();
    expect(admin.mfa.deleteFactor).toHaveBeenCalledWith({ id: 'f2', userId: 'u1' });
  });
  it('stops at a failed delete', async () => {
    admin.mfa.listFactors.mockResolvedValue({ data: { factors: [{ id: 'f1', status: 'verified' }] }, error: null });
    admin.mfa.deleteFactor.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(await resetAuthFactors('u1')).toBe('Something went wrong. Please try again.');
  });
});

describe('hasVerifiedFactor', () => {
  it('is true only with a verified factor', async () => {
    admin.mfa.listFactors.mockResolvedValueOnce({ data: { factors: [{ id: 'f1', status: 'verified' }] }, error: null });
    expect(await hasVerifiedFactor('u1')).toBe(true);
    admin.mfa.listFactors.mockResolvedValueOnce({ data: { factors: [{ id: 'f1', status: 'unverified' }] }, error: null });
    expect(await hasVerifiedFactor('u1')).toBe(false);
  });
  it('is null when Auth cannot say', async () => {
    admin.mfa.listFactors.mockResolvedValueOnce({ data: null, error: { message: 'down' } });
    expect(await hasVerifiedFactor('u1')).toBeNull();
  });
});

describe('listSignIns', () => {
  it('pages through every user', async () => {
    const page = (n: number, from: number) => ({
      data: { users: Array.from({ length: n }, (_, i) => ({ id: `u${from + i}`, last_sign_in_at: i === 0 ? null : '2026-10-01T08:00:00Z' })) },
      error: null,
    });
    admin.listUsers.mockResolvedValueOnce(page(1000, 0)).mockResolvedValueOnce(page(3, 1000));
    const map = await listSignIns(Array.from({ length: 1003 }, (_, i) => `u${i}`));
    expect(map.size).toBe(1003);
    expect(map.get('u0')).toBeNull();
    expect(map.get('u1002')).toBe('2026-10-01T08:00:00Z');
    expect(admin.listUsers).toHaveBeenNthCalledWith(1, { page: 1, perPage: 1000 });
    expect(admin.listUsers).toHaveBeenNthCalledWith(2, { page: 2, perPage: 1000 });
  });
  it('throws on failure rather than show everyone as never signed in', async () => {
    admin.listUsers.mockResolvedValue({ data: { users: [] }, error: { message: 'down' } });
    await expect(listSignIns(['u1'])).rejects.toThrow();
  });
  it('returns only the ids asked for', async () => {
    admin.listUsers.mockResolvedValue({ data: { users: [{ id: 'a', last_sign_in_at: null }, { id: 'b', last_sign_in_at: '2026-10-01T08:00:00Z' }] }, error: null });
    const map = await listSignIns(['a']);
    expect([...map.keys()]).toEqual(['a']);
  });
});

describe('inviteLink', () => {
  it('builds the confirm link on this request’s origin', async () => {
    admin.getUserById.mockResolvedValue(user({ last_sign_in_at: null, email_confirmed_at: null }));
    admin.generateLink.mockResolvedValue({ data: { properties: { hashed_token: 'h a/sh' } }, error: null });
    expect(await inviteLink('u1')).toEqual({
      email: 'old@example.com',
      link: 'https://academy.example.com/auth/confirm?token_hash=h%20a%2Fsh&type=invite',
    });
    expect(admin.generateLink).toHaveBeenCalledWith({ type: 'invite', email: 'old@example.com', options: { redirectTo: 'https://academy.example.com/auth/confirm' } });
  });
  it('refuses someone who has signed in', async () => {
    admin.getUserById.mockResolvedValue(user());
    expect(await inviteLink('u1')).toEqual({ error: 'This user has already signed in.' });
    expect(admin.generateLink).not.toHaveBeenCalled();
  });
  it("refuses a confirmed login (Auth won't invite it again)", async () => {
    admin.getUserById.mockResolvedValue(user({ last_sign_in_at: null }));
    expect(await inviteLink('u1')).toEqual({ error: "This login's email is already confirmed, so there is no invite to resend. Use Reset password instead." });
  });
  it('shows the mapped error when Auth refuses', async () => {
    admin.getUserById.mockResolvedValue(user({ last_sign_in_at: null, email_confirmed_at: null }));
    admin.generateLink.mockResolvedValue({ data: null, error: { code: 'over_request_rate_limit', message: 'x' } });
    expect(await inviteLink('u1')).toEqual({ error: 'Too many attempts. Wait a minute and try again.' });
  });
});

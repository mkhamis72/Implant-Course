import { describe, it, expect, vi, beforeEach } from 'vitest';

const COMPANY = 'company-a';
const { admin, requestPasswordReset } = vi.hoisted(() => ({
  admin: { listUsers: vi.fn(), deleteUser: vi.fn(), setDisabled: vi.fn(), setPassword: vi.fn(), updateEmail: vi.fn(), resetTotp: vi.fn(), unlinkGoogle: vi.fn() },
  requestPasswordReset: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/self-auth/tenant', () => ({ tenantAuth: async () => ({ admin, requestPasswordReset }) }));
vi.mock('@/lib/tenant/current', () => ({ currentTenant: async () => ({ slug: 'academy', companyId: COMPANY }) }));
import {
  changeAuthEmail, deleteAuthUser, hasVerifiedFactor, listAccounts, resetAuthFactors, sendPasswordLink, setAuthDisabled, setOneTimePassword, unlinkGoogle, invitePending,
} from './auth-accounts';

class CodedError extends Error {
  constructor(public code: string) { super(`private detail ${code}`); this.name = 'SelfAuthError'; }
}
const row = (over: Record<string, unknown> = {}) => ({
  userId: 'u1', email: 'a@example.com', disabled: false, hasPassword: true, hasTotp: false, hasGoogle: false,
  createdAt: new Date('2026-01-01'), lastSignInAt: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  admin.listUsers.mockResolvedValue([row()]);
  for (const f of [admin.deleteUser, admin.setDisabled, admin.setPassword, admin.updateEmail, admin.resetTotp, admin.unlinkGoogle, requestPasswordReset]) f.mockResolvedValue(undefined);
});

describe('every call carries this host\'s company', () => {
  it('delete, disable, email, reset 2FA', async () => {
    expect(await deleteAuthUser('u1')).toBeNull();
    expect(admin.deleteUser).toHaveBeenCalledWith(COMPANY, 'u1');
    expect(await setAuthDisabled('u1', true)).toBeNull();
    expect(admin.setDisabled).toHaveBeenCalledWith(COMPANY, 'u1', true);
    expect(await resetAuthFactors('u1')).toBeNull();
    expect(admin.resetTotp).toHaveBeenCalledWith(COMPANY, 'u1');
    await changeAuthEmail('u1', 'new@example.com');
    expect(admin.updateEmail).toHaveBeenCalledWith(COMPANY, 'u1', 'new@example.com');
    expect(admin.listUsers).toHaveBeenCalledWith(COMPANY);
  });
});

describe('admin_cannot_touch_other_company_user', () => {
  it('a user of another company is "User not found." and nothing changes', async () => {
    for (const f of [admin.deleteUser, admin.setDisabled, admin.updateEmail, admin.resetTotp]) f.mockRejectedValue(new CodedError('user_not_found'));
    admin.listUsers.mockResolvedValue([]); // the other company's user isn't in this company's list
    expect(await setAuthDisabled('b-user', true)).toBe('User not found.');
    expect(await resetAuthFactors('b-user')).toBe('User not found.');
    expect(await deleteAuthUser('b-user')).toContain('User not found.');
    expect(await changeAuthEmail('b-user', 'x@example.com')).toEqual({ error: 'User not found.' });
    expect(await sendPasswordLink('b-user')).toEqual({ error: 'User not found.' });
    expect(admin.updateEmail).not.toHaveBeenCalled();
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });
});

describe('failures', () => {
  it('map to a message built from the code, never the error text, and log only the name', async () => {
    admin.setDisabled.mockRejectedValue(new Error('connection string postgres://secret'));
    expect(await setAuthDisabled('u1', true)).toBe('Something went wrong. Please try again.');
    expect(JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toContain('secret');
  });
});

describe('changeAuthEmail', () => {
  it('returns the old address and whether they ever signed in', async () => {
    admin.listUsers.mockResolvedValue([row({ lastSignInAt: new Date() })]);
    expect(await changeAuthEmail('u1', 'new@example.com')).toEqual({ previous: { email: 'a@example.com', signedInBefore: true } });
    admin.listUsers.mockResolvedValue([row({ hasPassword: false })]);
    expect(await changeAuthEmail('u1', 'new@example.com')).toEqual({ previous: { email: 'a@example.com', signedInBefore: false } });
  });
  it('email_change_notifies_old_address_after_sessions_revoked: a user with a password but no live session is established', async () => {
    admin.listUsers.mockResolvedValue([row({ hasPassword: true, lastSignInAt: null })]);
    expect(await changeAuthEmail('u1', 'new@example.com')).toEqual({ previous: { email: 'a@example.com', signedInBefore: true } });
  });
  it('a pending invite (no password, no session) is not established', async () => {
    admin.listUsers.mockResolvedValue([row({ hasPassword: false, lastSignInAt: null })]);
    expect(await changeAuthEmail('u1', 'new@example.com')).toEqual({ previous: { email: 'a@example.com', signedInBefore: false } });
  });
  it('refuses the address they already have, and a taken address', async () => {
    expect(await changeAuthEmail('u1', 'A@Example.com')).toEqual({ error: 'That is already their sign-in email.' });
    expect(admin.updateEmail).not.toHaveBeenCalled();
    admin.updateEmail.mockRejectedValue(new CodedError('email_taken'));
    expect(await changeAuthEmail('u1', 'taken@example.com')).toEqual({ error: 'Another account already uses that email.' });
  });
});

describe('sendPasswordLink', () => {
  it("asks Self-Auth to email the account's address; no link comes back", async () => {
    expect(await sendPasswordLink('u1')).toEqual({ email: 'a@example.com' });
    expect(requestPasswordReset).toHaveBeenCalledWith({ companyId: COMPANY, email: 'a@example.com', reportSendErrors: true });
  });
  it('is refused for a deactivated account', async () => {
    admin.listUsers.mockResolvedValue([row({ disabled: true })]);
    expect(await sendPasswordLink('u1')).toHaveProperty('error');
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });
  it('admin_send_failure_is_reported: a failed send is not reported as sent', async () => {
    requestPasswordReset.mockRejectedValueOnce(new CodedError('send_failed'));
    expect(await sendPasswordLink('u1')).toEqual({ error: "The email couldn't be sent. Try again later, or check the email settings." });
  });
});

describe('hasVerifiedFactor / listAccounts', () => {
  it('reads hasTotp; false for an unknown user; null when Self-Auth fails', async () => {
    admin.listUsers.mockResolvedValue([row({ hasTotp: true })]);
    expect(await hasVerifiedFactor('u1')).toBe(true);
    expect(await hasVerifiedFactor('nobody')).toBe(false);
    admin.listUsers.mockRejectedValue(new Error('db'));
    expect(await hasVerifiedFactor('u1')).toBeNull();
  });
  it('lists sign-in time, authenticator and password state by user id', async () => {
    admin.listUsers.mockResolvedValue([row({ lastSignInAt: new Date('2026-10-01T00:00:00Z'), hasTotp: true, hasGoogle: true }), row({ userId: 'u2', hasPassword: false })]);
    expect(await listAccounts()).toEqual(new Map([
      ['u1', { lastSignIn: '2026-10-01T00:00:00.000Z', hasFactor: true, hasPassword: true, hasGoogle: true }],
      ['u2', { lastSignIn: null, hasFactor: false, hasPassword: false, hasGoogle: false }],
    ]));
  });
  it('throws when Self-Auth cannot answer', async () => {
    admin.listUsers.mockRejectedValue(new Error('db'));
    await expect(listAccounts()).rejects.toThrow();
  });
});

describe('invitePending', () => {
  it('invite_pending_false_when_google_used', () => {
    const base = { lastSignIn: null, hasFactor: false };
    expect(invitePending({ ...base, hasPassword: false, hasGoogle: false })).toBe(true);
    expect(invitePending({ ...base, hasPassword: false, hasGoogle: true })).toBe(false);
    expect(invitePending({ ...base, hasPassword: true, hasGoogle: false })).toBe(false);
    expect(invitePending(undefined)).toBe(false);
  });
});

describe('unlinkGoogle', () => {
  it("unlinks for this host's company; returns a message for another company's user", async () => {
    expect(await unlinkGoogle('u1')).toBeNull();
    expect(admin.unlinkGoogle).toHaveBeenCalledWith(COMPANY, 'u1');
    admin.unlinkGoogle.mockRejectedValue(new CodedError('user_not_found'));
    expect(await unlinkGoogle('u9')).toBe('User not found.');
  });
});

describe('setOneTimePassword', () => {
  it("sets a long URL-safe password for this host's company and returns it", async () => {
    const r = await setOneTimePassword('u1');
    expect(r).toEqual({ password: expect.stringMatching(/^[A-Za-z0-9_-]{16,}$/) });
    expect(admin.setPassword).toHaveBeenCalledWith(COMPANY, 'u1', (r as { password: string }).password);
  });
  it('a user of another company is "User not found." and no password is returned', async () => {
    admin.setPassword.mockRejectedValue(new CodedError('user_not_found'));
    expect(await setOneTimePassword('b-user')).toEqual({ error: 'User not found.' });
  });
  it('never logs the password', async () => {
    admin.setPassword.mockRejectedValue(new Error('boom'));
    const r = await setOneTimePassword('u1');
    expect(r).toHaveProperty('error');
    expect(JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toMatch(/[A-Za-z0-9_-]{16,}/);
  });
});

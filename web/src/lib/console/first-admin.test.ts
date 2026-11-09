import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFirstAdmin, inviteFirstAdmin } from './first-admin';

vi.mock('server-only', () => ({}));

const calls: string[] = [];
const admin = {
  listUsers: vi.fn(),
  createUser: vi.fn(),
  invite: vi.fn(),
  setPassword: vi.fn(),
  setDisabled: vi.fn(),
};
const requestPasswordReset = vi.fn();
vi.mock('@/lib/self-auth/tenant', () => ({ tenantAuth: async () => ({ admin, requestPasswordReset }) }));

const COMPANY = 'b0000000-0000-4000-8000-00000000000b';

function fakeDb(opts: { rpcError?: string; cancelError?: string } = {}) {
  return {
    from: () => { throw new Error('tables must not be read or written directly'); },
    auth: { admin: new Proxy({}, { get: () => { throw new Error('Supabase Auth is not used any more'); } }) },
    rpc: vi.fn(async (fn: string, args: object) => {
      calls.push(`${fn} ${JSON.stringify(args)}`);
      const message = fn === 'console_cancel_pending_login' ? opts.cancelError : opts.rpcError;
      return { data: null, error: message ? { message } : null };
    }),
  } as never;
}

const ARGS = { companyId: COMPANY, email: 'owner@acme.com', fullName: 'Dr Owner' };
const addCall = `console_add_first_admin {"p_company":"${COMPANY}","p_email":"owner@acme.com","p_full_name":"Dr Owner"}`;
const cancelCall = `console_cancel_pending_login {"p_company":"${COMPANY}","p_email":"owner@acme.com"}`;
const account = (over: object = {}) => ({ userId: 'old-id', email: 'owner@acme.com', disabled: false, hasPassword: true, hasTotp: false, createdAt: new Date(), lastSignInAt: null, ...over });
const code = (c: string) => Object.assign(new Error('x'), { code: c });

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
  admin.listUsers.mockResolvedValue([]);
  admin.createUser.mockImplementation(async () => { calls.push('create'); return { userId: 'new-id' }; });
  admin.invite.mockImplementation(async () => { calls.push('invite'); return { userId: 'new-id' }; });
  admin.setPassword.mockImplementation(async () => { calls.push('setPassword'); });
  admin.setDisabled.mockImplementation(async () => { calls.push('setDisabled'); });
  requestPasswordReset.mockImplementation(async () => { calls.push('reset-email'); });
});

describe('createFirstAdmin', () => {
  it("writes the company's pending admin login, then creates the account on that company", async () => {
    const r = await createFirstAdmin(fakeDb(), { ...ARGS, email: ' Owner@Acme.com ' });
    expect(r.outcome).toBe('created');
    expect(r.password.length).toBeGreaterThanOrEqual(12);
    expect(calls).toEqual([addCall, 'create']);
    expect(admin.createUser).toHaveBeenCalledWith({ companyId: COMPANY, email: 'owner@acme.com', password: r.password });
  });

  it("resets the password of the company's own existing account and lifts a deactivation", async () => {
    admin.listUsers.mockResolvedValue([account({ disabled: true })]);
    const r = await createFirstAdmin(fakeDb(), ARGS);
    expect(r.outcome).toBe('reset');
    expect(calls).toEqual([addCall, 'setPassword', 'setDisabled']);
    expect(admin.setPassword).toHaveBeenCalledWith(COMPANY, 'old-id', r.password);
    expect(admin.setDisabled).toHaveBeenCalledWith(COMPANY, 'old-id', false);
  });

  it('removes the pending row again when creating the account fails', async () => {
    admin.createUser.mockRejectedValue(code('weak_password'));
    await expect(createFirstAdmin(fakeDb(), ARGS)).rejects.toThrow('The login could not be created');
    expect(calls).toEqual([addCall, cancelCall]);
  });

  it('still reports the failure when the pending row cannot be removed', async () => {
    admin.createUser.mockRejectedValue(code('boom'));
    await expect(createFirstAdmin(fakeDb({ cancelError: 'db down' }), ARGS)).rejects.toThrow('The login could not be created');
  });

  it('creates nothing when the pending row fails', async () => {
    await expect(createFirstAdmin(fakeDb({ rpcError: 'Unknown company.' }), ARGS)).rejects.toThrow('Unknown company.');
    expect(admin.createUser).not.toHaveBeenCalled();
  });

  it('never puts the password in an error', async () => {
    admin.createUser.mockRejectedValue(new Error('failed with password hunter2'));
    const err = await createFirstAdmin(fakeDb(), ARGS).catch((e: Error) => e);
    expect((err as Error).message).not.toContain('hunter2');
  });
});

describe('inviteFirstAdmin', () => {
  it('writes the pending admin login, then invites on the company: no link is built here', async () => {
    const r = await inviteFirstAdmin(fakeDb(), ARGS);
    expect(r).toEqual({ outcome: 'invited' });
    expect(calls).toEqual([addCall, 'invite']);
    expect(admin.invite).toHaveBeenCalledWith({ companyId: COMPANY, email: 'owner@acme.com' });
    expect(JSON.stringify(r)).not.toMatch(/https?:|token/i);
  });

  it('sends a password-reset email to the company\'s own account that already has a password', async () => {
    admin.listUsers.mockResolvedValue([account()]);
    expect(await inviteFirstAdmin(fakeDb(), ARGS)).toEqual({ outcome: 'reset_sent' });
    expect(requestPasswordReset).toHaveBeenCalledWith({ companyId: COMPANY, email: 'owner@acme.com' });
    expect(admin.invite).not.toHaveBeenCalled();
  });

  it('sends the link again to an account that never set a password', async () => {
    admin.listUsers.mockResolvedValue([account({ hasPassword: false })]);
    expect(await inviteFirstAdmin(fakeDb(), ARGS)).toEqual({ outcome: 'reinvited' });
    expect(requestPasswordReset).toHaveBeenCalledWith({ companyId: COMPANY, email: 'owner@acme.com' });
  });

  it('lifts a deactivation on an existing account', async () => {
    admin.listUsers.mockResolvedValue([account({ disabled: true })]);
    await inviteFirstAdmin(fakeDb(), ARGS);
    expect(admin.setDisabled).toHaveBeenCalledWith(COMPANY, 'old-id', false);
  });

  it('removes the pending row again when the invite fails', async () => {
    admin.invite.mockRejectedValue(code('email_failed'));
    await expect(inviteFirstAdmin(fakeDb(), ARGS)).rejects.toThrow('The invite could not be sent');
    expect(calls).toEqual([addCall, cancelCall]);
  });

  it('keeps the membership of an existing account when sending fails', async () => {
    admin.listUsers.mockResolvedValue([account()]);
    requestPasswordReset.mockRejectedValue(code('boom'));
    await expect(inviteFirstAdmin(fakeDb(), ARGS)).rejects.toThrow('The password-reset email could not be sent');
    expect(calls).not.toContain(cancelCall);
  });
});

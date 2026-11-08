import { describe, it, expect, vi } from 'vitest';
import { createFirstAdmin, inviteFirstAdmin } from './first-admin';

vi.mock('server-only', () => ({}));

const COMPANY = 'b0000000-0000-4000-8000-00000000000b';

function fakeCompany(opts: { existing?: string; elsewhere?: boolean; rpcError?: string; createError?: string; cancelError?: string } = {}) {
  const calls: string[] = [];
  const rows = (data: object[]) => ({ eq: () => ({ limit: async () => ({ data, error: null }), neq: () => ({ limit: async () => ({ data, error: null }) }) }) });
  const client = {
    from: (table: string) => ({
      select: () => table === 'profiles'
        ? rows(opts.existing ? [{ user_id: opts.existing }] : [])
        : rows(opts.elsewhere ? [{ company_id: 'other' }] : []),
      update: () => { throw new Error('tables must not be updated directly'); },
    }),
    rpc: vi.fn(async (fn: string, args: object) => {
      calls.push(`${fn} ${JSON.stringify(args)}`);
      const message = fn === 'console_cancel_pending_login' ? opts.cancelError : opts.rpcError;
      return { data: null, error: message ? { message } : null };
    }),
    auth: { admin: {
      createUser: vi.fn(async () => {
        calls.push('create');
        return opts.createError ? { data: { user: null }, error: { message: opts.createError } } : { data: { user: { id: 'new-id' } }, error: null };
      }),
      updateUserById: vi.fn(async (id: string, attrs: object) => { calls.push(`update ${id} ${Object.keys(attrs).sort().join(',')}`); return { data: {}, error: null }; }),
    } },
  };
  return { client: client as never, calls, auth: client.auth.admin };
}

const ARGS = { companyId: COMPANY, email: 'owner@acme.com', fullName: 'Dr Owner' };
const addCall = `console_add_first_admin {"p_company":"${COMPANY}","p_email":"owner@acme.com","p_full_name":"Dr Owner"}`;
const cancelCall = `console_cancel_pending_login {"p_company":"${COMPANY}","p_email":"owner@acme.com"}`;

describe('createFirstAdmin', () => {
  it("writes the company's pending admin login, then creates the confirmed user", async () => {
    const { client, calls } = fakeCompany();
    const r = await createFirstAdmin(client, { ...ARGS, email: ' Owner@Acme.com ' });
    expect(r.outcome).toBe('created');
    expect(r.outcome === 'created' && r.password.length).toBeGreaterThanOrEqual(12);
    expect(calls).toEqual([addCall, 'create']);
  });

  it("resets the password of the company's own existing login", async () => {
    const { client, calls } = fakeCompany({ existing: 'old-id' });
    const r = await createFirstAdmin(client, ARGS);
    expect(r.outcome).toBe('reset');
    expect(calls).toEqual([addCall, 'update old-id ban_duration,password']);
  });

  it('adds an account another company uses as admin, lifts a ban, and never touches its password', async () => {
    const { client, calls, auth } = fakeCompany({ existing: 'shared-id', elsewhere: true });
    const r = await createFirstAdmin(client, ARGS);
    expect(r).toEqual({ outcome: 'added' });
    expect(calls).toEqual([addCall, 'update shared-id ban_duration']);
    expect(auth.updateUserById).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ password: expect.anything() }));
  });

  it('creates no Auth user when the database refuses the admin', async () => {
    const { client, calls } = fakeCompany({ rpcError: 'Unknown company.' });
    await expect(createFirstAdmin(client, ARGS)).rejects.toThrow('The login was not finished: Unknown company.');
    expect(calls).toEqual([addCall]);
  });

  it('removes the pending admin login again when the Auth call fails', async () => {
    const { client, calls } = fakeCompany({ createError: 'email exists' });
    await expect(createFirstAdmin(client, ARGS)).rejects.toThrow('The login could not be created: email exists');
    expect(calls).toEqual([addCall, 'create', cancelCall]);
  });

  it('only warns when that removal fails too', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = fakeCompany({ createError: 'email exists', cancelError: 'boom' });
    await expect(createFirstAdmin(client, ARGS)).rejects.toThrow('The login could not be created: email exists');
    expect(warn).toHaveBeenCalledWith('The pending admin login could not be removed:', 'boom');
    warn.mockRestore();
  });
});

describe('inviteFirstAdmin', () => {
  const ORIGIN = 'https://acme.imploid.net';
  const INVITE = { ...ARGS, companyName: 'Acme Dental', origin: ORIGIN };
  function fakeInvite(opts: { existing?: string; elsewhere?: boolean; confirmed?: boolean; inviteError?: string } = {}) {
    const base = fakeCompany({ existing: opts.existing, elsewhere: opts.elsewhere });
    const client = base.client as unknown as { auth: Record<string, unknown> & { admin: Record<string, unknown> } };
    Object.assign(client.auth.admin, {
      inviteUserByEmail: vi.fn(async (email: string, o: object) => {
        base.calls.push(`invite ${email} ${JSON.stringify(o)}`);
        return { data: {}, error: opts.inviteError ? { message: opts.inviteError } : null };
      }),
      getUserById: vi.fn(async () => ({ data: { user: { id: opts.existing, email_confirmed_at: opts.confirmed ? '2026-11-01T00:00:00Z' : null } }, error: null })),
    });
    client.auth.resetPasswordForEmail = vi.fn(async (email: string, o: object) => {
      base.calls.push(`reset ${email} ${JSON.stringify(o)}`);
      return { data: {}, error: null };
    });
    const send = vi.fn(async () => 'sent' as const);
    return { ...base, send };
  }
  const redirect = JSON.stringify({ redirectTo: `${ORIGIN}/auth/confirm` });

  it('invites a new address to the company’s own address; no password anywhere', async () => {
    const { client, calls, send } = fakeInvite();
    const r = await inviteFirstAdmin(client, { ...INVITE, email: ' Owner@Acme.com ' }, send);
    expect(r).toEqual({ outcome: 'invited' });
    expect(calls).toEqual([addCall, `invite owner@acme.com ${redirect}`]);
    expect(send).not.toHaveBeenCalled();
  });

  it('cancels the pending admin login when the invite fails', async () => {
    const { client, calls, send } = fakeInvite({ inviteError: 'SMTP down' });
    await expect(inviteFirstAdmin(client, INVITE, send)).rejects.toThrow('The invite could not be sent: SMTP down');
    expect(calls).toEqual([addCall, `invite owner@acme.com ${redirect}`, cancelCall]);
  });

  it('invites the company’s own login again while it never confirmed', async () => {
    const { client, calls, send } = fakeInvite({ existing: 'u1' });
    expect(await inviteFirstAdmin(client, INVITE, send)).toEqual({ outcome: 'reinvited' });
    expect(calls).toEqual([addCall, 'update u1 ban_duration', `invite owner@acme.com ${redirect}`]);
  });

  it('sends a password-reset email to the company’s own confirmed login', async () => {
    const { client, calls, send } = fakeInvite({ existing: 'u1', confirmed: true });
    expect(await inviteFirstAdmin(client, INVITE, send)).toEqual({ outcome: 'reset_sent' });
    expect(calls).toEqual([addCall, 'update u1 ban_duration', `reset owner@acme.com ${redirect}`]);
  });

  it('adds an account another company uses, keeps its password and sends a notice without a link', async () => {
    const { client, calls, send } = fakeInvite({ existing: 'u1', elsewhere: true, confirmed: true });
    expect(await inviteFirstAdmin(client, INVITE, send)).toEqual({ outcome: 'added', noticeSent: true });
    expect(calls).toEqual([addCall, 'update u1 ban_duration']);
    const [mail] = send.mock.calls[0] as unknown as [{ to: string; subject: string; html: string }];
    expect(mail.to).toBe('owner@acme.com');
    expect(mail.subject).toBe("You've been added to Acme Dental");
    expect(mail.html).not.toContain('href');
  });
});

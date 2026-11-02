import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const { auth, rpc, sendEmail, calls } = vi.hoisted(() => ({
  auth: { createUser: vi.fn(), inviteUserByEmail: vi.fn(), deleteUser: vi.fn(), updateUserById: vi.fn() },
  rpc: vi.fn(),
  sendEmail: vi.fn(),
  calls: [] as string[],
}));
vi.mock('server-only', () => ({}));
const { adminProfile } = vi.hoisted(() => ({ adminProfile: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(async () => ({
    auth: { admin: auth },
    from: () => ({ select: () => ({ eq: (_col: string, email: string) => ({ limit: async () => adminProfile(email) }) }) }),
  })),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));
vi.mock('@/lib/tenant/current', () => ({ requestOrigin: async () => 'http://localhost:3000' }));
vi.mock('@/lib/email/send', () => ({ sendEmail }));
vi.mock('@/lib/branding/get', () => ({ getBranding: async () => ({ name: 'Zz Company B' }) }));
import { createLogin } from './create-login';

const fresh = (id = 'u1') => ({ data: { user: { id, created_at: new Date().toISOString() } }, error: null });

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  adminProfile.mockReturnValue({ data: [], error: null });
  rpc.mockImplementation(async (name: string) => (calls.push(name), { data: null, error: null }));
  auth.inviteUserByEmail.mockImplementation(async () => (calls.push('invite'), fresh()));
  auth.createUser.mockImplementation(async () => (calls.push('createUser'), fresh()));
  auth.updateUserById.mockResolvedValue({ data: {}, error: null });
  sendEmail.mockResolvedValue('sent');
});
afterEach(() => vi.unstubAllEnvs());

describe('createLogin: a new address', () => {
  it('with email off: the pending row first, then a confirmed account and a one-time password', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'false');
    const r = await createLogin({ email: 'd@example.com', full_name: 'Dr D', role: 'delegate', delegate_id: 'd1' });
    expect(rpc).toHaveBeenCalledWith('create_pending_login', { p_email: 'd@example.com', p_full_name: 'Dr D', p_role: 'delegate', p_delegate_id: 'd1' });
    expect(calls).toEqual(['create_pending_login', 'createUser']);
    expect(auth.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'd@example.com', email_confirm: true }));
    expect(auth.inviteUserByEmail).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: 'Login created for d@example.com.' });
    expect((r as { password: string }).password).toBe(auth.createUser.mock.calls[0][0].password);
  });

  it('with email on: create_pending_login before the invitation, no password', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'true');
    const r = await createLogin({ email: 'o@example.com', full_name: 'Org O', role: 'organizer' });
    expect(calls).toEqual(['create_pending_login', 'invite']);
    expect(rpc).toHaveBeenCalledWith('create_pending_login', { p_email: 'o@example.com', p_full_name: 'Org O', p_role: 'organizer', p_delegate_id: null });
    expect(auth.inviteUserByEmail).toHaveBeenCalledWith('o@example.com', { redirectTo: 'http://localhost:3000/auth/confirm' });
    expect(auth.createUser).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: 'Invitation sent to o@example.com. The link verifies their email address.' });
  });

  it('returns the error of create_pending_login without any Auth call', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'true');
    rpc.mockResolvedValue({ data: null, error: { message: 'Only admins can do this.', hint: 'user' } });
    expect(await createLogin({ email: 'o@example.com', full_name: 'O', role: 'organizer' })).toEqual({ error: 'Only admins can do this.' });
    expect(auth.inviteUserByEmail).not.toHaveBeenCalled();
    expect(auth.createUser).not.toHaveBeenCalled();
  });

  it('refuses an invite that returned an older account, and leaves it alone', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'true');
    auth.inviteUserByEmail.mockResolvedValue({ data: { user: { id: 'old', created_at: new Date(Date.now() - 3600_000).toISOString() } }, error: null });
    const r = await createLogin({ email: 'o@example.com', full_name: 'Org O', role: 'organizer' });
    expect(r).toEqual({ error: 'A user with this email already exists.' });
    expect(auth.deleteUser).not.toHaveBeenCalled();
    expect(calls).toEqual(['create_pending_login', 'cancel_pending_login']);
    expect(rpc).toHaveBeenCalledWith('cancel_pending_login', { p_email: 'o@example.com' });
  });

  it('removes the pending row again when Auth refuses', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'true');
    auth.inviteUserByEmail.mockResolvedValue({ data: { user: null }, error: { message: 'boom', status: 500 } });
    const r = await createLogin({ email: 'o@example.com', full_name: 'Org O', role: 'organizer' });
    expect(r).toHaveProperty('error');
    expect(calls).toEqual(['create_pending_login', 'cancel_pending_login']);
    expect(rpc).toHaveBeenCalledWith('cancel_pending_login', { p_email: 'o@example.com' });
  });

  it('removes the pending row again when the Auth call throws, and returns an error', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'false');
    auth.createUser.mockRejectedValue(new Error('network down'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await createLogin({ email: 'o@example.com', full_name: 'Org O', role: 'organizer' })).toEqual({ error: 'Could not create the login.' });
    expect(calls).toEqual(['create_pending_login', 'cancel_pending_login']);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('a failed clean-up only warns', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'true');
    auth.inviteUserByEmail.mockResolvedValue({ data: { user: null }, error: { message: 'boom', status: 500 } });
    rpc.mockImplementation(async (name: string) => (calls.push(name),
      name === 'cancel_pending_login' ? { data: null, error: { message: 'down' } } : { data: null, error: null }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await createLogin({ email: 'o@example.com', full_name: 'Org O', role: 'organizer' })).toHaveProperty('error');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('a fresh account leaves the pending row to handle_new_user', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'true');
    await createLogin({ email: 'o@example.com', full_name: 'Org O', role: 'organizer' });
    expect(rpc).not.toHaveBeenCalledWith('cancel_pending_login', expect.anything());
  });
});

describe('createLogin: an address that already has an account', () => {
  it('adds them to this company, sends one notice, and makes no Auth call', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'true');
    adminProfile.mockReturnValue({ data: [{ user_id: 'other' }], error: null });
    rpc.mockResolvedValue({ data: 'other', error: null });
    const r = await createLogin({ email: ' Other@Example.com ', full_name: 'O', role: 'organizer' });
    expect(adminProfile).toHaveBeenCalledWith('other@example.com');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('add_existing_member', { p_email: 'other@example.com', p_role: 'organizer', p_delegate_id: null });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'other@example.com', subject: "You've been added to Zz Company B" }));
    expect(r).toEqual({ ok: 'Added other@example.com to this company. They sign in with their existing password.' });
    expect(auth.inviteUserByEmail).not.toHaveBeenCalled();
    expect(auth.createUser).not.toHaveBeenCalled();
  });

  it('lifts an Auth ban left from a deactivation elsewhere, after adding the membership', async () => {
    adminProfile.mockReturnValue({ data: [{ user_id: 'other' }], error: null });
    rpc.mockImplementation(async (name: string) => (calls.push(name), { data: 'other', error: null }));
    auth.updateUserById.mockImplementation(async () => (calls.push('unban'), { data: {}, error: null }));
    expect(await createLogin({ email: 'other@example.com', full_name: 'O', role: 'organizer' })).toHaveProperty('ok');
    expect(auth.updateUserById).toHaveBeenCalledWith('other', { ban_duration: 'none' });
    expect(calls).toEqual(['add_existing_member', 'unban']);
  });

  it('a failed unban only warns', async () => {
    adminProfile.mockReturnValue({ data: [{ user_id: 'other' }], error: null });
    rpc.mockResolvedValue({ data: 'other', error: null });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    auth.updateUserById.mockResolvedValueOnce({ data: null, error: { message: 'down' } });
    expect(await createLogin({ email: 'other@example.com', full_name: 'O', role: 'organizer' })).toHaveProperty('ok');
    auth.updateUserById.mockRejectedValueOnce(new Error('fetch failed'));
    expect(await createLogin({ email: 'other@example.com', full_name: 'O', role: 'organizer' })).toHaveProperty('ok');
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('a refusal lifts no ban', async () => {
    adminProfile.mockReturnValue({ data: [{ user_id: 'here' }], error: null });
    rpc.mockResolvedValue({ data: null, error: { message: 'A user with this email already exists.', hint: 'user' } });
    await createLogin({ email: 'here@example.com', full_name: 'H', role: 'organizer' });
    expect(auth.updateUserById).not.toHaveBeenCalled();
  });

  it('a failed notice only warns', async () => {
    adminProfile.mockReturnValue({ data: [{ user_id: 'other' }], error: null });
    rpc.mockResolvedValue({ data: 'other', error: null });
    sendEmail.mockResolvedValue('failed');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await createLogin({ email: 'other@example.com', full_name: 'O', role: 'organizer' })).toHaveProperty('ok');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('shows the refusal of add_existing_member (already a member here) and sends nothing', async () => {
    adminProfile.mockReturnValue({ data: [{ user_id: 'here' }], error: null });
    rpc.mockResolvedValue({ data: null, error: { message: 'A user with this email already exists.', hint: 'user' } });
    expect(await createLogin({ email: 'here@example.com', full_name: 'H', role: 'organizer' })).toEqual({ error: 'A user with this email already exists.' });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(auth.inviteUserByEmail).not.toHaveBeenCalled();
    expect(auth.createUser).not.toHaveBeenCalled();
  });
});

describe('createLogin: failures before anything is written', () => {
  it('stops when the lookup errors, before any write or Auth call', async () => {
    adminProfile.mockReturnValue({ data: null, error: { message: 'boom' } });
    expect(await createLogin({ email: 'o@example.com', full_name: 'O', role: 'organizer' })).toEqual({ error: 'Could not check this email. Try again.' });
    expect(rpc).not.toHaveBeenCalled();
    expect(auth.inviteUserByEmail).not.toHaveBeenCalled();
    expect(auth.createUser).not.toHaveBeenCalled();
  });

  it('reports an unavailable admin connection without creating anything', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    vi.mocked(createAdminClient).mockRejectedValueOnce(new Error("This action isn't available right now. Please try again later."));
    expect(await createLogin({ email: 'x@example.com', full_name: 'X', role: 'organizer' })).toEqual({
      error: "This action isn't available right now. Please try again later.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});

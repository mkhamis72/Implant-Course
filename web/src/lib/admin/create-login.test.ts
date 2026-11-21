import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const { admin, rpc, calls } = vi.hoisted(() => ({
  admin: { createUser: vi.fn(), invite: vi.fn() },
  rpc: vi.fn(),
  calls: [] as string[],
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));
vi.mock('@/lib/self-auth/tenant', () => ({ tenantAuth: async () => ({ admin }) }));
vi.mock('@/lib/tenant/current', () => ({ currentTenant: async () => ({ slug: 'academy', companyId: 'company-a' }) }));
import { createLogin } from './create-login';

class CodedError extends Error {
  constructor(public code: string) { super(`secret detail for ${code}`); this.name = 'SelfAuthError'; }
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  rpc.mockImplementation(async (name: string) => (calls.push(name), { data: null, error: null }));
  admin.invite.mockImplementation(async () => (calls.push('invite'), { userId: 'u1' }));
  admin.createUser.mockImplementation(async () => (calls.push('createUser'), { userId: 'u1' }));
});
afterEach(() => vi.unstubAllEnvs());

describe('createLogin', () => {
  it('with email off: the pending row first, then an account with a one-time password in this company', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'false');
    const r = await createLogin({ email: ' D@Example.com ', full_name: 'Dr D', role: 'delegate', delegate_id: 'd1' });
    expect(rpc).toHaveBeenCalledWith('create_pending_login_v2', {
      p_email: 'd@example.com', p_full_name: 'Dr D', p_role: 'delegate', p_delegate_id: 'd1', p_doctor: null, p_new_doctor: false,
    });
    expect(calls).toEqual(['create_pending_login_v2', 'createUser']);
    expect(admin.createUser).toHaveBeenCalledWith({ companyId: 'company-a', email: 'd@example.com', password: expect.any(String) });
    expect(admin.invite).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: 'Login created for d@example.com.' });
    expect((r as { password: string }).password).toBe(admin.createUser.mock.calls[0][0].password);
  });

  it('with email on: the pending row first, then Self-Auth sends the invitation (no password, no link)', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'true');
    const r = await createLogin({ email: 'o@example.com', full_name: 'Org O', role: 'organizer' });
    expect(calls).toEqual(['create_pending_login_v2', 'invite']);
    expect(admin.invite).toHaveBeenCalledWith({ companyId: 'company-a', email: 'o@example.com' });
    expect(admin.createUser).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: 'Invitation sent to o@example.com.' });
  });

  it('returns the error of create_pending_login_v2 without any Self-Auth call', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Only admins can invite.', code: 'P0001' } });
    expect(await createLogin({ email: 'o@example.com', full_name: 'Org O', role: 'organizer' })).toHaveProperty('error');
    expect(admin.invite).not.toHaveBeenCalled();
    expect(admin.createUser).not.toHaveBeenCalled();
  });

  it('create_login_rolls_back_pending_row: the invite throws, and the pending row is cancelled', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'true');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    admin.invite.mockRejectedValueOnce(new Error('smtp down'));
    const r = await createLogin({ email: 'o@example.com', full_name: 'Org O', role: 'organizer' });
    expect(r).toEqual({ error: 'Could not create the login.' });
    expect(calls).toEqual(['create_pending_login_v2', 'cancel_pending_login']);
    expect(rpc).toHaveBeenLastCalledWith('cancel_pending_login', { p_email: 'o@example.com' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('smtp down');
    log.mockRestore();
  });

  it('the same rollback when createUser throws (email off)', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'false');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    admin.createUser.mockRejectedValueOnce(new Error('db'));
    expect(await createLogin({ email: 'o@example.com', full_name: 'Org O', role: 'organizer' })).toEqual({ error: 'Could not create the login.' });
    expect(calls).toEqual(['create_pending_login_v2', 'cancel_pending_login']);
  });

  it('an address that already has an account here says so and removes the pending row', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'true');
    admin.invite.mockRejectedValueOnce(new CodedError('email_taken'));
    expect(await createLogin({ email: 'o@example.com', full_name: 'Org O', role: 'organizer' })).toEqual({ error: 'A user with this email already exists.' });
    expect(calls).toEqual(['create_pending_login_v2', 'cancel_pending_login']);
  });

  it('a failing cancel only warns', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'true');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    admin.invite.mockRejectedValueOnce(new Error('x'));
    rpc.mockImplementationOnce(async () => ({ data: null, error: null })).mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    expect(await createLogin({ email: 'o@example.com', full_name: 'Org O', role: 'organizer' })).toEqual({ error: 'Could not create the login.' });
    expect(warn).toHaveBeenCalled();
  });

  it('passes the doctor choice to create_pending_login_v2', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'true');
    await createLogin({ email: 'n@example.com', full_name: 'Dr N', role: 'organizer', doctor_id: 'doc1', new_doctor: false });
    expect(rpc).toHaveBeenCalledWith('create_pending_login_v2', {
      p_email: 'n@example.com', p_full_name: 'Dr N', p_role: 'organizer', p_delegate_id: null, p_doctor: 'doc1', p_new_doctor: false,
    });
  });

  it('a failed invite for a new doctor cancels the pending login, so no orphan doctor remains', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'true');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    admin.invite.mockRejectedValueOnce(new Error('smtp down'));
    const r = await createLogin({ email: 'n@example.com', full_name: 'Dr N', role: 'organizer', new_doctor: true });
    expect(r).toEqual({ error: 'Could not create the login.' });
    expect(rpc).toHaveBeenNthCalledWith(1, 'create_pending_login_v2', expect.objectContaining({ p_doctor: null, p_new_doctor: true }));
    expect(calls).toEqual(['create_pending_login_v2', 'cancel_pending_login']);
    expect(rpc).toHaveBeenLastCalledWith('cancel_pending_login', { p_email: 'n@example.com' });
  });
});

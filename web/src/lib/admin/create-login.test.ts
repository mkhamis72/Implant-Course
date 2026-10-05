import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const { auth, profileUpdate } = vi.hoisted(() => ({
  auth: { createUser: vi.fn(), inviteUserByEmail: vi.fn(), deleteUser: vi.fn() },
  profileUpdate: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ auth: { admin: auth } }) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({ update: (values: unknown) => ({ eq: () => ({ select: async () => profileUpdate(values) }) }) }),
  }),
}));
vi.mock('@/lib/env', () => ({ serverEnv: () => ({ siteUrl: 'http://localhost:3000' }) }));
import { createLogin } from './create-login';

beforeEach(() => {
  vi.clearAllMocks();
  profileUpdate.mockReturnValue({ data: [{ user_id: 'u1' }], error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe('createLogin', () => {
  it('with email off: a confirmed account, the profile set, and a one-time password', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'false');
    auth.createUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    const r = await createLogin({ email: 'd@example.com', full_name: 'Dr D', role: 'delegate', delegate_id: 'd1' });
    expect(auth.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'd@example.com', email_confirm: true }));
    expect(auth.inviteUserByEmail).not.toHaveBeenCalled();
    expect(profileUpdate).toHaveBeenCalledWith({ full_name: 'Dr D', role: 'delegate', delegate_id: 'd1', active: true });
    expect(r).toMatchObject({ ok: 'Login created for d@example.com.' });
    expect((r as { password: string }).password).toBe(auth.createUser.mock.calls[0][0].password);
  });

  it('with email on: an invitation that verifies the address, no password', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'true');
    auth.inviteUserByEmail.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    const r = await createLogin({ email: 'o@example.com', full_name: 'Org O', role: 'organizer' });
    expect(auth.inviteUserByEmail).toHaveBeenCalledWith('o@example.com', { redirectTo: 'http://localhost:3000/auth/confirm' });
    expect(auth.createUser).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: 'Invitation sent to o@example.com. The link verifies their email address.' });
  });

  it('removes the account again when the profile cannot be set', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'false');
    auth.createUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    profileUpdate.mockReturnValue({ data: [], error: null });
    const r = await createLogin({ email: 'x@example.com', full_name: 'X', role: 'organizer' });
    expect(auth.deleteUser).toHaveBeenCalledWith('u1');
    expect(r).toHaveProperty('error');
  });
});

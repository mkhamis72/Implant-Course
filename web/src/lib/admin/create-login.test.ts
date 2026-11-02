import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const { auth, profileUpdate, existing } = vi.hoisted(() => ({
  auth: { createUser: vi.fn(), inviteUserByEmail: vi.fn(), deleteUser: vi.fn() },
  profileUpdate: vi.fn(),
  existing: vi.fn(),
}));
vi.mock('server-only', () => ({}));
const { adminProfile } = vi.hoisted(() => ({ adminProfile: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(async () => ({
    auth: { admin: auth },
    from: () => ({ select: () => ({ eq: (_col: string, email: string) => ({ limit: async () => adminProfile(email) }) }) }),
  })),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({
      update: (values: unknown) => ({ eq: () => ({ select: async () => profileUpdate(values) }) }),
      select: () => ({ eq: (_col: string, email: string) => ({ limit: async () => existing(email) }) }),
    }),
  }),
}));
vi.mock('@/lib/tenant/current', () => ({ requestOrigin: async () => 'http://localhost:3000' }));
import { createLogin } from './create-login';

beforeEach(() => {
  vi.clearAllMocks();
  profileUpdate.mockReturnValue({ data: [{ user_id: 'u1' }], error: null });
  existing.mockReturnValue({ data: [], error: null });
  adminProfile.mockReturnValue({ data: [], error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe('createLogin', () => {
  it('with email off: a confirmed account, the profile set, and a one-time password', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'false');
    auth.createUser.mockResolvedValue({ data: { user: { id: 'u1', created_at: new Date().toISOString() } }, error: null });
    const r = await createLogin({ email: 'd@example.com', full_name: 'Dr D', role: 'delegate', delegate_id: 'd1' });
    expect(auth.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'd@example.com', email_confirm: true }));
    expect(auth.inviteUserByEmail).not.toHaveBeenCalled();
    expect(profileUpdate).toHaveBeenCalledWith({ full_name: 'Dr D', role: 'delegate', delegate_id: 'd1', active: true });
    expect(r).toMatchObject({ ok: 'Login created for d@example.com.' });
    expect((r as { password: string }).password).toBe(auth.createUser.mock.calls[0][0].password);
  });

  it('with email on: an invitation that verifies the address, no password', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'true');
    auth.inviteUserByEmail.mockResolvedValue({ data: { user: { id: 'u1', created_at: new Date().toISOString() } }, error: null });
    const r = await createLogin({ email: 'o@example.com', full_name: 'Org O', role: 'organizer' });
    expect(auth.inviteUserByEmail).toHaveBeenCalledWith('o@example.com', { redirectTo: 'http://localhost:3000/auth/confirm' });
    expect(auth.createUser).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: 'Invitation sent to o@example.com. The link verifies their email address.' });
  });

  it('refuses an email that already has an account, without touching Auth', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'true');
    existing.mockReturnValue({ data: [{ user_id: 'old' }], error: null });
    const r = await createLogin({ email: ' Taken@Example.com ', full_name: 'T', role: 'delegate', delegate_id: 'd1' });
    expect(existing).toHaveBeenCalledWith('taken@example.com');
    expect(r).toEqual({ error: 'A user with this email already exists.' });
    expect(auth.inviteUserByEmail).not.toHaveBeenCalled();
    expect(auth.createUser).not.toHaveBeenCalled();
  });

  it('refuses an email that has a profile in any company (admin lookup), without touching Auth', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'true');
    adminProfile.mockReturnValue({ data: [{ user_id: 'other' }], error: null });
    const r = await createLogin({ email: ' Other@Example.com ', full_name: 'O', role: 'organizer' });
    expect(adminProfile).toHaveBeenCalledWith('other@example.com');
    expect(r).toEqual({ error: 'A user with this email already exists.' });
    expect(auth.inviteUserByEmail).not.toHaveBeenCalled();
    expect(auth.createUser).not.toHaveBeenCalled();
  });

  it('refuses an invite that returned an older account, and leaves it alone', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'true');
    auth.inviteUserByEmail.mockResolvedValue({ data: { user: { id: 'old', created_at: new Date(Date.now() - 3600_000).toISOString() } }, error: null });
    const r = await createLogin({ email: 'o@example.com', full_name: 'Org O', role: 'organizer' });
    expect(r).toEqual({ error: 'A user with this email already exists.' });
    expect(auth.deleteUser).not.toHaveBeenCalled();
    expect(profileUpdate).not.toHaveBeenCalled();
  });

  it('proceeds for a freshly created user', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'true');
    auth.inviteUserByEmail.mockResolvedValue({ data: { user: { id: 'u1', created_at: new Date().toISOString() } }, error: null });
    const r = await createLogin({ email: 'o@example.com', full_name: 'Org O', role: 'organizer' });
    expect(r).toHaveProperty('ok');
    expect(profileUpdate).toHaveBeenCalled();
  });

  it('removes the account again when the profile cannot be set', async () => {
    vi.stubEnv('EMAIL_ENABLED', 'false');
    auth.createUser.mockResolvedValue({ data: { user: { id: 'u1', created_at: new Date().toISOString() } }, error: null });
    profileUpdate.mockReturnValue({ data: [], error: null });
    const r = await createLogin({ email: 'x@example.com', full_name: 'X', role: 'organizer' });
    expect(auth.deleteUser).toHaveBeenCalledWith('u1');
    expect(r).toHaveProperty('error');
  });

  it('reports an unavailable admin connection without creating anything', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    vi.mocked(createAdminClient).mockRejectedValueOnce(new Error("This action isn't available right now. Please try again later."));
    expect(await createLogin({ email: 'x@example.com', full_name: 'X', role: 'organizer' })).toEqual({
      error: "This action isn't available right now. Please try again later.",
    });
  });
});

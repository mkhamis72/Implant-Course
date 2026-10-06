import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createLogin, rpc, deleteAuthUser, setTemporaryPassword } = vi.hoisted(() => ({
  createLogin: vi.fn(), rpc: vi.fn(), deleteAuthUser: vi.fn(), setTemporaryPassword: vi.fn(),
}));
vi.mock('@/lib/auth/session', () => ({ requireAdmin: vi.fn(async () => ({ user_id: 'me' })) }));
vi.mock('@/lib/admin/create-login', () => ({ createLogin }));
vi.mock('@/lib/admin/auth-accounts', () => ({ deleteAuthUser, setTemporaryPassword }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ rpc })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/env', () => ({ serverEnv: () => ({ siteUrl: 'http://localhost:3000' }) }));
import { inviteUser, removeUser, resetPassword, savePermissions } from './actions';

beforeEach(() => vi.clearAllMocks());

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe('inviteUser', () => {
  it('creates the login and passes back a one-time password when there is one', async () => {
    createLogin.mockResolvedValue({ ok: 'Login created for new@example.com.', password: 'Temp-Pass-123' });
    const r = await inviteUser({}, form({ email: 'New@Example.com', full_name: 'Dr New', role: 'organizer' }));
    expect(createLogin).toHaveBeenCalledWith({ email: 'new@example.com', full_name: 'Dr New', role: 'organizer' });
    expect(r).toEqual({ ok: 'Login created for new@example.com.', password: 'Temp-Pass-123' });
  });
  it('validates before creating anything', async () => {
    expect(await inviteUser({}, form({ email: 'nope', full_name: 'Dr New', role: 'organizer' }))).toHaveProperty('error');
    expect(createLogin).not.toHaveBeenCalled();
  });
});

describe('savePermissions', () => {
  const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
  const grid = { user_id: id, perm_patients: 'edit', perm_schedule: 'view', perm_courses: 'none', perm_checklists: 'none', perm_inventory: 'view', perm_delegates: 'none' };
  it('saves the grid through set_user_permissions', async () => {
    rpc.mockResolvedValue({ error: null });
    expect(await savePermissions({}, form(grid))).toEqual({ ok: 'Permissions saved.' });
    expect(rpc).toHaveBeenCalledWith('set_user_permissions', {
      p_user: id,
      p_perms: { patients: 'edit', schedule: 'view', courses: null, checklists: null, inventory: 'view', delegates: null },
    });
  });
  it('shows the database’s refusal', async () => {
    rpc.mockResolvedValue({ error: { message: 'You cannot change your own permissions.', hint: 'user' } });
    expect(await savePermissions({}, form(grid))).toEqual({ error: 'You cannot change your own permissions.' });
  });
});

describe('removeUser', () => {
  const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
  it('removes the profile through delete_user, then the sign-in account', async () => {
    rpc.mockResolvedValue({ error: null });
    deleteAuthUser.mockResolvedValue(null);
    expect(await removeUser({}, form({ id }))).toEqual({ ok: 'User removed.' });
    expect(rpc).toHaveBeenCalledWith('delete_user', { p_user: id });
    expect(deleteAuthUser).toHaveBeenCalledWith(id);
  });
  it('keeps the account when the database refuses (e.g. the user has records)', async () => {
    rpc.mockResolvedValue({ error: { message: 'Dr X has records in the app … Deactivate them instead.', hint: 'user' } });
    expect(await removeUser({}, form({ id }))).toEqual({ error: 'Dr X has records in the app … Deactivate them instead.' });
    expect(deleteAuthUser).not.toHaveBeenCalled();
  });
  it('says so when the sign-in account could not be deleted', async () => {
    rpc.mockResolvedValue({ error: null });
    deleteAuthUser.mockResolvedValue('Something went wrong.');
    expect(await removeUser({}, form({ id }))).toHaveProperty('error');
  });
  it('rejects a malformed id before touching anything', async () => {
    expect(await removeUser({}, form({ id: 'nope' }))).toHaveProperty('error');
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('resetPassword', () => {
  const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
  it('sets and passes back a new one-time password', async () => {
    setTemporaryPassword.mockResolvedValue({ password: 'New-Temp-1' });
    expect(await resetPassword({}, form({ user_id: id }))).toEqual({ ok: 'New one-time password set.', password: 'New-Temp-1' });
    expect(setTemporaryPassword).toHaveBeenCalledWith(id);
  });
  it('is not for your own account', async () => {
    expect(await resetPassword({}, form({ user_id: 'me' }))).toHaveProperty('error');
    expect(setTemporaryPassword).not.toHaveBeenCalled();
  });
});

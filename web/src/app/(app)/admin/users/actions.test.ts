import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createLogin, rpc } = vi.hoisted(() => ({ createLogin: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ requireAdmin: vi.fn(async () => ({ user_id: 'me' })) }));
vi.mock('@/lib/admin/create-login', () => ({ createLogin }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ rpc })) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/env', () => ({ serverEnv: () => ({ siteUrl: 'http://localhost:3000' }) }));
import { inviteUser, savePermissions } from './actions';

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

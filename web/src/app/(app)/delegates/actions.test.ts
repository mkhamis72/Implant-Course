import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createLogin, delegateRow, loginRow } = vi.hoisted(() => ({ createLogin: vi.fn(), delegateRow: vi.fn(), loginRow: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ requireAdmin: vi.fn(async () => ({ user_id: 'me' })), requirePermission: vi.fn() }));
vi.mock('@/lib/admin/create-login', () => ({ createLogin }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => (table === 'delegates' ? delegateRow() : loginRow()) }) }),
    }),
  }),
}));
import { createDelegateLogin } from './actions';

const form = () => {
  const f = new FormData();
  f.set('delegate_id', 'd1');
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  delegateRow.mockReturnValue({ data: { id: 'd1', full_name: 'Dr D', email: 'D@Example.com' } });
  loginRow.mockReturnValue({ data: null });
});

describe('createDelegateLogin', () => {
  it('creates a delegate login with the normalised email', async () => {
    createLogin.mockResolvedValue({ ok: 'Login created for d@example.com.', password: 'x' });
    expect(await createDelegateLogin({}, form())).toEqual({ ok: 'Login created for d@example.com.', password: 'x' });
    expect(createLogin).toHaveBeenCalledWith({ email: 'd@example.com', full_name: 'Dr D', role: 'delegate', delegate_id: 'd1' });
  });
  it('refuses a second login for the same delegate', async () => {
    loginRow.mockReturnValue({ data: { user_id: 'u1' } });
    expect(await createDelegateLogin({}, form())).toEqual({ error: 'This delegate already has a login.' });
    expect(createLogin).not.toHaveBeenCalled();
  });
  it('needs an email address', async () => {
    delegateRow.mockReturnValue({ data: { id: 'd1', full_name: 'Dr D', email: '' } });
    expect(await createDelegateLogin({}, form())).toEqual({ error: 'Add the delegate’s email address first.' });
  });
});

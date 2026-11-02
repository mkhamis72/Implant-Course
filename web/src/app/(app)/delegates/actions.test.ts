import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createLogin, delegateRow, loginRow, loginQuery, rpc, deleteAuthUser, redirect } = vi.hoisted(() => ({
  createLogin: vi.fn(), delegateRow: vi.fn(), loginRow: vi.fn(), loginQuery: vi.fn(), rpc: vi.fn(), deleteAuthUser: vi.fn(), redirect: vi.fn(),
}));
const { A } = vi.hoisted(() => ({ A: 'a7c0de00-0000-4000-8000-000000000001' }));
vi.mock('@/lib/tenant/current', () => ({ currentTenant: async () => ({ slug: 'academy', companyId: A }) }));
vi.mock('@/lib/auth/session', () => ({ requireAdmin: vi.fn(async () => ({ user_id: 'me' })), requirePermission: vi.fn() }));
vi.mock('@/lib/admin/create-login', () => ({ createLogin }));
vi.mock('@/lib/admin/auth-accounts', () => ({ deleteAuthUser }));
const { profileRemains } = vi.hoisted(() => ({ profileRemains: vi.fn() }));
vi.mock('@/lib/admin/same-company', () => ({ profileRemains }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc,
    from: (table: string) => {
      const filters: unknown[][] = [];
      const chain = {
        select: () => chain,
        eq: (col: string, value: unknown) => (filters.push([col, value]), chain),
        maybeSingle: async () => {
          if (table === 'delegates') return delegateRow();
          loginQuery(table, filters);
          return loginRow();
        },
      };
      return chain;
    },
  }),
}));
import { createDelegateLogin, deleteDelegate } from './actions';

const form = () => {
  const f = new FormData();
  f.set('delegate_id', 'd1');
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  delegateRow.mockReturnValue({ data: { id: 'd1', full_name: 'Dr D', email: 'D@Example.com' } });
  loginRow.mockReturnValue({ data: null });
  profileRemains.mockResolvedValue(false);
});

describe('createDelegateLogin', () => {
  it('creates a delegate login with the normalised email', async () => {
    createLogin.mockResolvedValue({ ok: 'Login created for d@example.com.', password: 'x' });
    expect(await createDelegateLogin({}, form())).toEqual({ ok: 'Login created for d@example.com.', password: 'x' });
    expect(createLogin).toHaveBeenCalledWith({ email: 'd@example.com', full_name: 'Dr D', role: 'delegate', delegate_id: 'd1' });
  });
  it("looks for an existing login among this company's members", async () => {
    createLogin.mockResolvedValue({ ok: 'Login created for d@example.com.' });
    await createDelegateLogin({}, form());
    expect(loginQuery).toHaveBeenCalledWith('company_members', [['company_id', A], ['delegate_id', 'd1']]);
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

describe('deleteDelegate', () => {
  const del = () => {
    const f = new FormData();
    f.set('id', 'd1');
    return f;
  };
  it('deletes the delegate and goes back to the list', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await deleteDelegate({}, del());
    expect(rpc).toHaveBeenCalledWith('delete_delegate', { p_delegate: 'd1' });
    expect(deleteAuthUser).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith('/delegates');
  });
  it('also deletes the sign-in account of a delegate login', async () => {
    rpc.mockResolvedValue({ data: 'u1', error: null });
    deleteAuthUser.mockResolvedValue(null);
    await deleteDelegate({}, del());
    expect(deleteAuthUser).toHaveBeenCalledWith('u1');
  });
  it('keeps the sign-in account of a login another company still has', async () => {
    rpc.mockResolvedValue({ data: 'u1', error: null });
    profileRemains.mockResolvedValue(true);
    await deleteDelegate({}, del());
    expect(profileRemains).toHaveBeenCalledWith('u1');
    expect(deleteAuthUser).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith('/delegates');
  });
  it('deletes no sign-in account when the profile could not be checked', async () => {
    rpc.mockResolvedValue({ data: 'u1', error: null });
    profileRemains.mockResolvedValue(null);
    expect(await deleteDelegate({}, del())).toEqual({
      error: "The delegate was removed, but it couldn't be checked whether their sign-in account can be deleted.",
    });
    expect(deleteAuthUser).not.toHaveBeenCalled();
  });
  it('shows the database’s refusal and keeps everything', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'This delegate has implant records …', hint: 'user' } });
    expect(await deleteDelegate({}, del())).toEqual({ error: 'This delegate has implant records …' });
    expect(redirect).not.toHaveBeenCalled();
  });
});

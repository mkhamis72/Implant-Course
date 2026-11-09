import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
const h = vi.hoisted(() => ({ cookie: null as string | null, getSession: vi.fn(), issueDbToken: vi.fn() }));
vi.mock('./cookie', () => ({ readSessionCookie: async () => h.cookie }));
vi.mock('./tenant', () => ({ tenantAuth: async () => ({ getSession: h.getSession, issueDbToken: h.issueDbToken }) }));
vi.mock('@/lib/tenant/current', () => ({ currentTenant: async () => ({ companyId: 'company-b' }) }));
import { currentSelfAuthSession, requestDbToken } from './session';

beforeEach(() => {
  h.cookie = 'tok';
  h.getSession.mockReset();
  h.issueDbToken.mockReset();
});

describe('currentSelfAuthSession', () => {
  it('asks for the session of THIS host\'s company', async () => {
    h.getSession.mockResolvedValue({ sessionId: 's' });
    expect(await currentSelfAuthSession()).toEqual({ sessionId: 's' });
    expect(h.getSession).toHaveBeenCalledWith('tok', 'company-b');
  });
  it('session_cookie_is_company_bound: a cookie from another company resolves to no session', async () => {
    h.getSession.mockResolvedValue(null);
    expect(await currentSelfAuthSession()).toBeNull();
  });
  it('no cookie means no lookup', async () => {
    h.cookie = null;
    expect(await currentSelfAuthSession()).toBeNull();
    expect(h.getSession).not.toHaveBeenCalled();
  });
});

describe('requestDbToken', () => {
  it('mints from the session, and not at all without one', async () => {
    h.getSession.mockResolvedValue({ sessionId: 's' });
    h.issueDbToken.mockResolvedValue('jwt');
    expect(await requestDbToken()).toBe('jwt');
    h.getSession.mockResolvedValue(null);
    h.issueDbToken.mockClear();
    h.cookie = null;
    expect(await requestDbToken()).toBeNull();
    expect(h.issueDbToken).not.toHaveBeenCalled();
  });
});

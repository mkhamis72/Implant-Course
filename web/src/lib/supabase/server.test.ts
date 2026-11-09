import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
const h = vi.hoisted(() => ({ token: null as string | null, minted: 0, create: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: (...a: unknown[]) => h.create(...a) }));
vi.mock('@/lib/tenant/current', () => ({
  currentTenant: async () => ({ slug: 'academy', supabaseUrl: 'https://a.supabase.co', anonKey: 'anon', companyId: 'c1' }),
}));
vi.mock('@/lib/self-auth/cookie', () => ({ readSessionCookie: async () => h.token }));
vi.mock('@/lib/self-auth/tenant', () => ({
  tenantAuth: async () => ({
    getSession: async () => ({ sessionId: 's1', userId: 'u1', companyId: 'c1', email: 'u@example.com', aal: 'aal1' }),
    issueDbToken: async () => 'db-token-' + ++h.minted,
  }),
}));
import { createClient } from './server';

beforeEach(() => {
  h.token = 'cookie';
  h.minted = 0;
  h.create.mockReset();
  h.create.mockReturnValue({});
});

const headersOf = (call: number) => (h.create.mock.calls[call][2] as { global?: { headers: Record<string, string> } }).global?.headers;

describe('createClient', () => {
  it('db_token_minted_per_request: two requests mint two different tokens', async () => {
    await createClient();
    await createClient();
    expect(h.minted).toBe(2);
    expect(headersOf(0)?.Authorization).toBe('Bearer db-token-1');
    expect(headersOf(1)?.Authorization).toBe('Bearer db-token-2');
  });

  it('without a session it uses the anon key and sends no bearer', async () => {
    h.token = null;
    await createClient();
    expect(h.create.mock.calls[0][1]).toBe('anon');
    expect(headersOf(0)).toBeUndefined();
    expect(h.minted).toBe(0);
  });

  it('never persists or refreshes a session in the client', async () => {
    await createClient();
    expect(h.create.mock.calls[0][2].auth).toMatchObject({ persistSession: false, autoRefreshToken: false });
  });
});

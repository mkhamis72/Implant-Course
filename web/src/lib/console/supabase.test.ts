import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
const h = vi.hoisted(() => ({ token: null as string | null, minted: 0, create: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: (...a: unknown[]) => h.create(...a) }));
vi.mock('@/lib/self-auth/console-session', () => ({
  consoleDbToken: async () => (h.token ? 'db-token-' + ++h.minted : null),
}));
import { createConsoleClient } from './supabase';

beforeEach(() => {
  h.token = 'cookie';
  h.minted = 0;
  h.create.mockReset();
  h.create.mockReturnValue({});
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://prod.example');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service');
});

const headers = (i: number) => (h.create.mock.calls[i][2] as { global?: { headers: Record<string, string> } }).global?.headers;

describe('createConsoleClient', () => {
  it('sends the console session database token as the bearer, minted per call', async () => {
    await createConsoleClient();
    await createConsoleClient();
    expect(h.create.mock.calls[0][0]).toBe('https://prod.example');
    expect(h.create.mock.calls[0][1]).toBe('anon');
    expect(headers(0)?.Authorization).toBe('Bearer db-token-1');
    expect(headers(1)?.Authorization).toBe('Bearer db-token-2');
  });
  it('without a session it sends no bearer', async () => {
    h.token = null;
    await createConsoleClient();
    expect(headers(0)).toBeUndefined();
  });
  it('never persists or refreshes a session in the client', async () => {
    await createConsoleClient();
    expect(h.create.mock.calls[0][2].auth).toMatchObject({ persistSession: false, autoRefreshToken: false });
  });
});

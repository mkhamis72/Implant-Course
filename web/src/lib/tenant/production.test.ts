import { describe, it, expect, vi, beforeEach } from 'vitest';

const { select, from, createClient } = vi.hoisted(() => {
  const select = vi.fn();
  const from = vi.fn(() => ({ select }));
  return { select, from, createClient: vi.fn(() => ({ from })) };
});
vi.mock('server-only', () => ({}));
vi.mock('@supabase/supabase-js', () => ({ createClient }));
import { productionTenants, resetProductionCache } from './production';
import { FRESH_MS, STALE_MS } from './list-cache';
import { RegistryUnavailableError } from './types';

const row = { id: 'c-osdic', slug: 'osdic', hosts: ['osdic.imploid.net'], status: 'active' };

beforeEach(() => {
  vi.clearAllMocks();
  resetProductionCache();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://prod.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
});

describe('productionTenants', () => {
  it('reads companies with the service key and fills the project from the env', async () => {
    select.mockResolvedValue({ data: [row], error: null });
    expect(await productionTenants(0)).toEqual([
      { slug: 'osdic', hosts: ['osdic.imploid.net'], supabaseUrl: 'https://prod.supabase.co', anonKey: 'anon', status: 'active', companyId: 'c-osdic' },
    ]);
    expect(createClient).toHaveBeenCalledWith('https://prod.supabase.co', 'svc', expect.anything());
    expect(from).toHaveBeenCalledWith('companies');
    expect(select).toHaveBeenCalledWith('id, slug, hosts, status');
  });
  it('a suspended company stays suspended; missing hosts are none', async () => {
    select.mockResolvedValue({ data: [{ ...row, status: 'suspended', hosts: null }], error: null });
    const [t] = await productionTenants(0);
    expect(t.status).toBe('suspended');
    expect(t.hosts).toEqual([]);
  });
  it('a failure inside 10 min serves the cached list, after that it is unavailable', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    select.mockResolvedValueOnce({ data: [row], error: null }).mockResolvedValue({ data: null, error: { message: 'down' } });
    await productionTenants(0);
    expect((await productionTenants(FRESH_MS + 1))[0].slug).toBe('osdic');
    await expect(productionTenants(STALE_MS + 1)).rejects.toBeInstanceOf(RegistryUnavailableError);
    err.mockRestore();
  });
  it('without the service key it is unavailable, not a crash elsewhere', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await expect(productionTenants(0)).rejects.toBeInstanceOf(RegistryUnavailableError);
  });
});

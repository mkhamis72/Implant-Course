import { describe, it, expect, vi, beforeEach } from 'vitest';

const { select, rpc } = vi.hoisted(() => ({ select: vi.fn(), rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({ select }), rpc }),
}));
import { controlTenants, controlSecret, resetControlCache, FRESH_MS, STALE_MS } from './control';
import { RegistryUnavailableError } from './types';

const row = { slug: 'academy', hosts: ['academy.example.com'], supabase_url: 'https://a.supabase.co', anon_key: 'anon', status: 'active' };
const tenant = { slug: 'academy', hosts: ['academy.example.com'], supabaseUrl: 'https://a.supabase.co', anonKey: 'anon', status: 'active' };

beforeEach(() => {
  vi.clearAllMocks();
  resetControlCache();
  process.env.CONTROL_SUPABASE_URL = 'https://control.supabase.co';
  process.env.CONTROL_SERVICE_ROLE_KEY = 'control-key';
});

describe('controlTenants', () => {
  it('maps rows and serves them from cache while fresh', async () => {
    select.mockResolvedValue({ data: [row], error: null });
    expect(await controlTenants(0)).toEqual([tenant]);
    expect(await controlTenants(FRESH_MS - 1)).toEqual([tenant]);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('refetches once fresh time is over', async () => {
    select.mockResolvedValue({ data: [row], error: null });
    await controlTenants(0);
    await controlTenants(FRESH_MS + 1);
    expect(select).toHaveBeenCalledTimes(2);
  });

  it('serves the last registry for up to 10 minutes when the control project fails', async () => {
    select.mockResolvedValueOnce({ data: [row], error: null });
    await controlTenants(0);
    select.mockResolvedValue({ data: null, error: { message: 'down' } });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await controlTenants(STALE_MS - 1)).toEqual([tenant]);
    expect(consoleErrorSpy).toHaveBeenCalled();
    await expect(controlTenants(STALE_MS + 1)).rejects.toBeInstanceOf(RegistryUnavailableError);
  });

  it('is unavailable when the very first fetch fails', async () => {
    select.mockRejectedValue(new Error('network'));
    await expect(controlTenants(0)).rejects.toBeInstanceOf(RegistryUnavailableError);
  });

  it('shares one in-flight fetch for concurrent calls on cold cache', async () => {
    select.mockResolvedValue({ data: [row], error: null });
    const [r1, r2] = await Promise.all([controlTenants(0), controlTenants(0)]);
    expect(r1).toEqual([tenant]);
    expect(r2).toEqual([tenant]);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('avoids retry within RETRY_MS after a failed refresh', async () => {
    select.mockResolvedValueOnce({ data: [row], error: null });
    await controlTenants(0);
    select.mockResolvedValue({ data: null, error: { message: 'down' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failureTime = FRESH_MS + 1;
    await controlTenants(failureTime);
    const RETRY_MS = 15_000;
    expect(await controlTenants(failureTime + RETRY_MS - 1)).toEqual([tenant]);
    expect(select).toHaveBeenCalledTimes(2);
    await controlTenants(failureTime + RETRY_MS);
    expect(select).toHaveBeenCalledTimes(3);
  });
});

describe('controlSecret', () => {
  it('reads through tenant_secret and caches', async () => {
    rpc.mockResolvedValue({ data: 'service-key', error: null });
    expect(await controlSecret('academy', 'service_role_key', 0)).toBe('service-key');
    expect(await controlSecret('academy', 'service_role_key', 1000)).toBe('service-key');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('tenant_secret', { p_slug: 'academy', p_name: 'service_role_key' });
  });

  it('throws when the secret is missing', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(controlSecret('academy', 'service_role_key', 0)).rejects.toThrow(/missing/);
  });

  it('shares one in-flight fetch for concurrent calls with the same key', async () => {
    rpc.mockResolvedValue({ data: 'service-key', error: null });
    const [r1, r2] = await Promise.all([
      controlSecret('academy', 'service_role_key', 0),
      controlSecret('academy', 'service_role_key', 0),
    ]);
    expect(r1).toBe('service-key');
    expect(r2).toBe('service-key');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

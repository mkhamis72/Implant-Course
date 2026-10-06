import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { currentTenant, tenantServiceKey, createClient } = vi.hoisted(() => ({
  currentTenant: vi.fn(),
  tenantServiceKey: vi.fn(),
  createClient: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant/current', () => ({ currentTenant }));
vi.mock('@/lib/tenant/registry', () => ({ tenantServiceKey }));
vi.mock('@supabase/supabase-js', () => ({ createClient }));
import { createAdminClient } from './admin';

const UNAVAILABLE = "This action isn't available right now. Please try again later.";
const tenant = { slug: 'academy', supabaseUrl: 'https://a.supabase.co', anonKey: 'k', status: 'active', hosts: [] };
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => consoleError.mockRestore());

describe('createAdminClient', () => {
  it('builds a client for the current company with its service key', async () => {
    currentTenant.mockResolvedValue(tenant);
    tenantServiceKey.mockResolvedValue('service-key');
    createClient.mockReturnValue({ marker: true });
    expect(await createAdminClient()).toEqual({ marker: true });
    expect(tenantServiceKey).toHaveBeenCalledWith('academy');
    expect(createClient).toHaveBeenCalledWith('https://a.supabase.co', 'service-key', expect.any(Object));
  });

  it('hides a key lookup failure behind the generic message', async () => {
    currentTenant.mockResolvedValue(tenant);
    tenantServiceKey.mockRejectedValue(new Error('vault down'));
    await expect(createAdminClient()).rejects.toThrow(new Error(UNAVAILABLE));
    expect(consoleError).toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('hides a missing company behind the generic message', async () => {
    currentTenant.mockRejectedValue(new Error('No company for this request'));
    await expect(createAdminClient()).rejects.toThrow(new Error(UNAVAILABLE));
    expect(consoleError).toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RegistryUnavailableError } from './types';

const { findTenantByHost, isSingleTenant } = vi.hoisted(() => ({ findTenantByHost: vi.fn(), isSingleTenant: vi.fn() }));
vi.mock('./registry', () => ({ findTenantByHost, isSingleTenant }));
import { routeHost } from './route';

const active = { slug: 'a', hosts: ['a.example.com'], supabaseUrl: 'https://a.supabase.co', anonKey: 'k', status: 'active' as const };

beforeEach(() => {
  vi.clearAllMocks();
  isSingleTenant.mockReturnValue(false);
});

describe('routeHost', () => {
  it('routes a known host (normalised first)', async () => {
    findTenantByHost.mockResolvedValue(active);
    expect(await routeHost('A.Example.com:443')).toEqual({ kind: 'tenant', tenant: active });
    expect(findTenantByHost).toHaveBeenCalledWith('a.example.com');
  });
  it('an unknown host is not found', async () => {
    findTenantByHost.mockResolvedValue(null);
    expect(await routeHost('nobody.example.com')).toEqual({ kind: 'not-found' });
  });
  it.each([null, '', '203.0.113.5', 'evil.com/x'])('a missing or invalid host (%s) is not found without a lookup', async (host) => {
    expect(await routeHost(host)).toEqual({ kind: 'not-found' });
    expect(findTenantByHost).not.toHaveBeenCalled();
  });
  it.each([null, '', '203.0.113.5', '127.0.0.1:3000', 'evil.com/x'])('single-tenant mode serves the default for any host (%s)', async (host) => {
    isSingleTenant.mockReturnValue(true);
    findTenantByHost.mockResolvedValue({ ...active, slug: 'default', hosts: ['*'] });
    expect(await routeHost(host)).toMatchObject({ kind: 'tenant' });
    expect(findTenantByHost).toHaveBeenCalledWith('*');
  });
  it('a suspended company is suspended', async () => {
    findTenantByHost.mockResolvedValue({ ...active, status: 'suspended' });
    expect(await routeHost('a.example.com')).toEqual({ kind: 'suspended' });
  });
  it('an unreachable registry is unavailable, never a guess', async () => {
    findTenantByHost.mockRejectedValue(new RegistryUnavailableError());
    expect(await routeHost('a.example.com')).toEqual({ kind: 'unavailable' });
  });
});

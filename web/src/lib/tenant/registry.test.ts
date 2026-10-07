import { describe, it, expect, vi, beforeEach } from 'vitest';

const { controlTenants, controlSecret } = vi.hoisted(() => ({ controlTenants: vi.fn(), controlSecret: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./control', () => ({ controlTenants, controlSecret }));
import { findTenantByHost, findTenantBySlug, isSingleTenant, tenantServiceKey } from './registry';

const a = { slug: 'a', hosts: ['a.example.com'], supabaseUrl: 'https://a.supabase.co', anonKey: 'anon', status: 'active' as const };

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ['CONTROL_SUPABASE_URL', 'TENANTS_FILE']) delete process.env[k];
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://dev.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
});

describe('single-tenant mode', () => {
  it('serves the default tenant on any host, with the env service key', async () => {
    expect((await findTenantByHost('anything.example'))?.slug).toBe('default');
    expect((await findTenantBySlug('default'))?.supabaseUrl).toBe('https://dev.supabase.co');
    expect(await tenantServiceKey('default')).toBe('svc');
    expect(controlTenants).not.toHaveBeenCalled();
  });
});

describe('single-tenant mode, more', () => {
  it('knows it is single-tenant only without control and TENANTS_FILE', () => {
    expect(isSingleTenant()).toBe(true);
    process.env.TENANTS_FILE = 'x.json';
    expect(isSingleTenant()).toBe(false);
    delete process.env.TENANTS_FILE;
    process.env.CONTROL_SUPABASE_URL = 'https://control.supabase.co';
    expect(isSingleTenant()).toBe(false);
  });
  it('a missing service key only fails tenantServiceKey, not routing', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect((await findTenantByHost('anything.example'))?.slug).toBe('default');
    expect((await findTenantBySlug('default'))?.slug).toBe('default');
    await expect(tenantServiceKey('default')).rejects.toThrow();
  });
});

describe('control mode', () => {
  beforeEach(() => {
    process.env.CONTROL_SUPABASE_URL = 'https://control.supabase.co';
    controlTenants.mockResolvedValue([a]);
  });
  it('matches only listed hosts', async () => {
    expect(await findTenantByHost('a.example.com')).toEqual(a);
    expect(await findTenantByHost('b.example.com')).toBeNull();
    expect(await findTenantBySlug('a')).toEqual(a);
  });
  it('reads the service key from Vault', async () => {
    controlSecret.mockResolvedValue('vault-key');
    expect(await tenantServiceKey('a')).toBe('vault-key');
    expect(controlSecret).toHaveBeenCalledWith('a', 'service_role_key');
  });
  it('does not honour wildcard hosts in control mode', async () => {
    controlTenants.mockResolvedValue([{ ...a, slug: 'wild', hosts: ['*'] }, a]);
    expect(await findTenantByHost('b.example.com')).toBeNull();
    expect(await findTenantByHost('a.example.com')).toEqual(a);
  });
});

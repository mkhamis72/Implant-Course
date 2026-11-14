import { describe, it, expect, vi, beforeEach } from 'vitest';

const { controlTenants, controlSecret, resetControlCache } = vi.hoisted(() => ({ controlTenants: vi.fn(), controlSecret: vi.fn(), resetControlCache: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./control', () => ({ controlTenants, controlSecret, resetControlCache }));
const { productionTenants, resetProductionCache } = vi.hoisted(() => ({ productionTenants: vi.fn(), resetProductionCache: vi.fn() }));
vi.mock('./production', () => ({ productionTenants, resetProductionCache }));
import { findTenantByCompanyId, findTenantByHost, findTenantBySlug, isSingleTenant, tenantServiceKey } from './registry';

const a = { slug: 'a', hosts: ['a.example.com'], supabaseUrl: 'https://a.supabase.co', anonKey: 'anon', status: 'active' as const };

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ['CONTROL_SUPABASE_URL', 'TENANTS_FILE', 'COMPANY_LIST']) delete process.env[k];
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
  it('looks a company id up again from the control project when the cached list lacks it', async () => {
    const added = { ...a, slug: 'new', hosts: ['new.example.com'], companyId: 'c-new' };
    controlTenants.mockResolvedValueOnce([a]).mockResolvedValueOnce([a, added]);
    expect(await findTenantByCompanyId('c-new')).toEqual(added);
    expect(resetControlCache).toHaveBeenCalledTimes(1);
  });
  it('does not refetch for a company id the list already has', async () => {
    controlTenants.mockResolvedValue([{ ...a, companyId: 'c-a' }]);
    expect((await findTenantByCompanyId('c-a'))?.slug).toBe('a');
    expect(resetControlCache).not.toHaveBeenCalled();
  });
  it('does not honour wildcard hosts in control mode', async () => {
    controlTenants.mockResolvedValue([{ ...a, slug: 'wild', hosts: ['*'] }, a]);
    expect(await findTenantByHost('b.example.com')).toBeNull();
    expect(await findTenantByHost('a.example.com')).toEqual(a);
  });
});

describe('production mode (COMPANY_LIST=production)', () => {
  const osdic = { ...a, slug: 'osdic', hosts: ['osdic.imploid.net'], companyId: 'c-osdic' };
  beforeEach(() => {
    process.env.COMPANY_LIST = 'production';
    process.env.CONTROL_SUPABASE_URL = 'https://control.supabase.co';
    productionTenants.mockResolvedValue([osdic]);
  });
  it('routes from the production list and never reads control', async () => {
    expect(await findTenantByHost('osdic.imploid.net')).toEqual(osdic);
    expect(await findTenantByHost('nope.imploid.net')).toBeNull();
    expect(await findTenantBySlug('osdic')).toEqual(osdic);
    expect(controlTenants).not.toHaveBeenCalled();
  });
  it('every company uses the project service key', async () => {
    expect(await tenantServiceKey('osdic')).toBe('svc');
    expect(controlSecret).not.toHaveBeenCalled();
  });
  it('a missing service key names the setting', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await expect(tenantServiceKey('osdic')).rejects.toThrow('SUPABASE_SERVICE_ROLE_KEY is not set');
  });
  it('an unknown company id resets the production list once and looks again', async () => {
    const added = { ...a, slug: 'new', companyId: 'c-new' };
    productionTenants.mockResolvedValueOnce([osdic]).mockResolvedValueOnce([osdic, added]);
    expect(await findTenantByCompanyId('c-new')).toEqual(added);
    expect(resetProductionCache).toHaveBeenCalledTimes(1);
    expect(resetControlCache).not.toHaveBeenCalled();
  });
  it('is not single-tenant', () => {
    delete process.env.CONTROL_SUPABASE_URL;
    expect(isSingleTenant()).toBe(false);
  });
});

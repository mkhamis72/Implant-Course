import { describe, it, expect, vi, beforeEach } from 'vitest';

const { productionTenants, resetProductionCache } = vi.hoisted(() => ({ productionTenants: vi.fn(), resetProductionCache: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./production', () => ({ productionTenants, resetProductionCache }));
import { findTenantByCompanyId, findTenantByHost, findTenantBySlug, tenantServiceKey } from './registry';

const osdic = { slug: 'osdic', hosts: ['osdic.imploid.net'], supabaseUrl: 'https://prod.supabase.co', anonKey: 'anon', status: 'active' as const, companyId: 'c-osdic' };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  productionTenants.mockResolvedValue([osdic]);
});

describe('registry (the production company list, release 3)', () => {
  it('routes from the production list with no setting at all', async () => {
    delete process.env.COMPANY_LIST;
    delete process.env.CONTROL_SUPABASE_URL;
    expect(await findTenantByHost('osdic.imploid.net')).toEqual(osdic);
    expect(await findTenantBySlug('osdic')).toEqual(osdic);
  });
  it('an unknown host is no company: there is no wildcard any more', async () => {
    expect(await findTenantByHost('nope.imploid.net')).toBeNull();
    expect(await findTenantByHost('*')).toBeNull();
  });
  it('every company uses the project service key', async () => {
    expect(await tenantServiceKey('osdic')).toBe('svc');
  });
  it('a missing service key names the setting', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await expect(tenantServiceKey('osdic')).rejects.toThrow('SUPABASE_SERVICE_ROLE_KEY is not set');
  });
  it('an unknown company id resets the list once and looks again', async () => {
    const added = { ...osdic, slug: 'new', companyId: 'c-new' };
    productionTenants.mockResolvedValueOnce([osdic]).mockResolvedValueOnce([osdic, added]);
    expect(await findTenantByCompanyId('c-new')).toEqual(added);
    expect(resetProductionCache).toHaveBeenCalledTimes(1);
  });
  it('a known company id does not refetch', async () => {
    expect((await findTenantByCompanyId('c-osdic'))?.slug).toBe('osdic');
    expect(resetProductionCache).not.toHaveBeenCalled();
  });
});

import { normaliseHost } from './host';
import { findTenantByHost, isSingleTenant } from './registry';
import { ANY_HOST } from './static';
import { RegistryUnavailableError, type Tenant } from './types';

export type Route = { kind: 'tenant'; tenant: Tenant } | { kind: 'not-found' } | { kind: 'suspended' } | { kind: 'unavailable' };

/** Which company a request is for, decided from its Host header only. */
export async function routeHost(rawHost: string | null): Promise<Route> {
  // Single-tenant mode serves every host (IPs, empty, unparseable) as before; other modes 404 them.
  const host = normaliseHost(rawHost) ?? (isSingleTenant() ? ANY_HOST : null);
  if (!host) return { kind: 'not-found' };
  try {
    const tenant = await findTenantByHost(host);
    if (!tenant) return { kind: 'not-found' };
    return tenant.status === 'active' ? { kind: 'tenant', tenant } : { kind: 'suspended' };
  } catch (error) {
    if (error instanceof RegistryUnavailableError) return { kind: 'unavailable' };
    throw error;
  }
}

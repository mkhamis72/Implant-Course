import { normaliseHost } from './host';
import { findTenantByHost } from './registry';
import { RegistryUnavailableError, type Tenant } from './types';

export type Route = { kind: 'tenant'; tenant: Tenant } | { kind: 'not-found' } | { kind: 'suspended' } | { kind: 'unavailable' };

/** Which company a request is for, decided from its Host header only. */
export async function routeHost(rawHost: string | null): Promise<Route> {
  const host = normaliseHost(rawHost);
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

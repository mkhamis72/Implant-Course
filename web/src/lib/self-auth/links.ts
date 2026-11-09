import 'server-only';
import { findTenantByCompanyId } from '@/lib/tenant/registry';

const isLocal = (host: string) => host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1';

/** The company's own origin, from the tenant registry (each company has its own host). */
export async function companyBaseUrl(companyId: string): Promise<string> {
  const tenant = await findTenantByCompanyId(companyId);
  const host = tenant && tenant.status === 'active' ? tenant.hosts.find((h) => h !== '*') : undefined;
  if (!host) throw new Error('No host for this company');
  const bare = host.replace(/:\d+$/, '');
  return `${isLocal(bare) ? 'http' : 'https'}://${host}`;
}

// Self-Auth's link builders are synchronous, so they return a path; the email adapter adds the company's origin.
export const resetLink = (_companyId: string, token: string) => `/auth/reset?token=${encodeURIComponent(token)}`;
export const inviteLink = (_companyId: string, token: string) => `/auth/invite?token=${encodeURIComponent(token)}`;

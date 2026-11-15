import 'server-only';
import { findTenantByCompanyId } from '@/lib/tenant/registry';
import { CONSOLE_COMPANY } from './constants';

const isLocal = (host: string) => host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1';

/** The company's own origin, from the tenant registry (each company has its own host). */
export async function companyBaseUrl(companyId: string): Promise<string> {
  if (companyId === CONSOLE_COMPANY) {
    const host = process.env.CONSOLE_HOST?.trim();
    if (!host) throw new Error('CONSOLE_HOST is not set (see .env.example)');
    return `${isLocal(host.replace(/:[0-9]+$/, '')) ? 'http' : 'https'}://${host}`;
  }
  const tenant = await findTenantByCompanyId(companyId);
  const host = tenant && tenant.status === 'active' ? tenant.hosts[0] : undefined;
  if (!host) throw new Error('No host for this company');
  const bare = host.replace(/:\d+$/, '');
  // Local companies (npm run dev:companies) are listed without a port: links go to the dev server's.
  if (isLocal(bare)) return `http://${host === bare ? `${bare}:${process.env.PORT || '3000'}` : host}`;
  return `https://${host}`;
}

// Self-Auth's link builders are synchronous, so they return a path; the email adapter adds the company's origin.
export const resetLink = (_companyId: string, token: string) => `/auth/reset?token=${encodeURIComponent(token)}`;
export const inviteLink = (_companyId: string, token: string) => `/auth/invite?token=${encodeURIComponent(token)}`;

import 'server-only';
import { productionTenants, resetProductionCache } from './production';
import type { Tenant } from './types';

/**
 * Every company lives in the one database and is listed in its public.companies (merge of control into
 * production, release 3). Local development gets its companies from `npm run dev:companies`.
 */
export async function findTenantByHost(host: string): Promise<Tenant | null> {
  return (await productionTenants()).find((t) => t.hosts.includes(host)) ?? null;
}

export async function findTenantBySlug(slug: string): Promise<Tenant | null> {
  return (await productionTenants()).find((t) => t.slug === slug) ?? null;
}

/** One database, one service key for every company. */
export async function tenantServiceKey(_slug: string): Promise<string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return key;
}

export async function findTenantByCompanyId(companyId: string): Promise<Tenant | null> {
  const known = (await productionTenants()).find((t) => t.companyId === companyId);
  if (known) return known;
  // A company the console has just added is not in this process's cached list yet (it is refetched every 60 s):
  // look again once before saying it is unknown (its first invite is emailed at once).
  resetProductionCache();
  return (await productionTenants()).find((t) => t.companyId === companyId) ?? null;
}

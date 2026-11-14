import 'server-only';
import { controlSecret, controlTenants, resetControlCache } from './control';
import { productionTenants, resetProductionCache } from './production';
import { listSource } from './source';
import { ANY_HOST, staticTenants, type StaticTenant } from './static';
import type { Tenant } from './types';

/** Neither a company list (production or control) nor TENANTS_FILE: today's single project. */
export const isSingleTenant = () => listSource() === 'static' && !process.env.TENANTS_FILE;

const publicPart = (t: StaticTenant): Tenant => ({ slug: t.slug, hosts: t.hosts, supabaseUrl: t.supabaseUrl, anonKey: t.anonKey, status: t.status, companyId: t.companyId });

async function all(): Promise<Tenant[]> {
  switch (listSource()) {
    case 'production': return productionTenants();
    case 'control': return controlTenants();
    default: return staticTenants().map(publicPart);
  }
}

export async function findTenantByHost(host: string): Promise<Tenant | null> {
  if (listSource() !== 'static') {
    return (await all()).find((t) => t.hosts.includes(host)) ?? null;
  }
  // Static mode: prefer exact match, then ANY_HOST
  const tenants = staticTenants().map(publicPart);
  return tenants.find((t) => t.hosts.includes(host)) ?? tenants.find((t) => t.hosts.includes(ANY_HOST)) ?? null;
}

export async function findTenantBySlug(slug: string): Promise<Tenant | null> {
  return (await all()).find((t) => t.slug === slug) ?? null;
}

/** The company's service-role key: the project's own in production mode, Vault in control mode, the static registry otherwise. */
export async function tenantServiceKey(slug: string): Promise<string> {
  const source = listSource();
  if (source === 'production') {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
    return key;
  }
  if (source === 'control') return controlSecret(slug, 'service_role_key');
  const t = staticTenants().find((s) => s.slug === slug);
  if (!t) throw new Error(`Unknown tenant ${slug}`);
  if (!t.serviceRoleKey) throw new Error('No service key configured');
  return t.serviceRoleKey;
}

export async function findTenantByCompanyId(companyId: string): Promise<Tenant | null> {
  const known = (await all()).find((t) => t.companyId === companyId);
  const source = listSource();
  if (known || source === 'static') return known ?? null;
  // A company the console has just added is not in this process's cached list yet (it is refetched every 60 s):
  // look again once before saying it is unknown (its first invite is emailed at once).
  if (source === 'production') resetProductionCache();
  else resetControlCache();
  return (await all()).find((t) => t.companyId === companyId) ?? null;
}

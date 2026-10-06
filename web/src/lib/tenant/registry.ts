import 'server-only';
import { controlSecret, controlTenants } from './control';
import { ANY_HOST, staticTenants, type StaticTenant } from './static';
import type { Tenant } from './types';

const usesControl = () => Boolean(process.env.CONTROL_SUPABASE_URL);
const publicPart = (t: StaticTenant): Tenant => ({ slug: t.slug, hosts: t.hosts, supabaseUrl: t.supabaseUrl, anonKey: t.anonKey, status: t.status });

async function all(): Promise<Tenant[]> {
  return usesControl() ? controlTenants() : staticTenants().map(publicPart);
}

export async function findTenantByHost(host: string): Promise<Tenant | null> {
  if (usesControl()) {
    return (await controlTenants()).find((t) => t.hosts.includes(host)) ?? null;
  }
  // Static mode: prefer exact match, then ANY_HOST
  const tenants = staticTenants().map(publicPart);
  return tenants.find((t) => t.hosts.includes(host)) ?? tenants.find((t) => t.hosts.includes(ANY_HOST)) ?? null;
}

export async function findTenantBySlug(slug: string): Promise<Tenant | null> {
  return (await all()).find((t) => t.slug === slug) ?? null;
}

/** The company's service-role key: Vault in control mode, the static registry otherwise. */
export async function tenantServiceKey(slug: string): Promise<string> {
  if (usesControl()) return controlSecret(slug, 'service_role_key');
  const t = staticTenants().find((s) => s.slug === slug);
  if (!t) throw new Error(`Unknown tenant ${slug}`);
  return t.serviceRoleKey;
}

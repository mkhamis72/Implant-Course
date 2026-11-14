import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createListCache } from './list-cache';
import type { Tenant } from './types';

export { FRESH_MS, STALE_MS } from './list-cache';
export const CONTROL_TIMEOUT_MS = 3_000;
const SECRET_MS = 5 * 60_000;

type Row = { slug: string; hosts: string[]; supabase_url: string; anon_key: string; status: 'active' | 'suspended'; company_id: string | null };

const secrets = new Map<string, { value: string; fetchedAt: number }>();
const secretInflight = new Map<string, Promise<string>>();

const list = createListCache(fetchTenants);

export function resetControlCache(): void {
  list.reset();
  secrets.clear();
  secretInflight.clear();
}

function control(): SupabaseClient {
  const url = process.env.CONTROL_SUPABASE_URL;
  const key = process.env.CONTROL_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('CONTROL_SUPABASE_URL / CONTROL_SERVICE_ROLE_KEY are not set');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS) }) },
  });
}

async function fetchTenants(): Promise<Tenant[]> {
  const { data, error } = await control().from('tenants').select('slug, hosts, supabase_url, anon_key, status, company_id');
  if (error || !data) throw new Error(error?.message ?? 'no data');
  return (data as Row[]).map((r): Tenant => ({
    slug: r.slug, hosts: r.hosts, supabaseUrl: r.supabase_url, anonKey: r.anon_key,
    // A company without a company id is never routed: it is answered with 503.
    status: r.company_id ? r.status : 'suspended',
    companyId: r.company_id ?? '',
  }));
}

/** All companies from the control project: fresh for 60 s, then refetched; a failed refetch keeps the old list for 10 min. */
export function controlTenants(now = Date.now()): Promise<Tenant[]> {
  return list.get(now);
}

/** A company's secret from the control project's Vault (cached 5 min). */
export async function controlSecret(slug: string, name: 'service_role_key' | 'database_url', now = Date.now()): Promise<string> {
  const key = `${slug}/${name}`;
  const hit = secrets.get(key);
  if (hit && now - hit.fetchedAt < SECRET_MS) return hit.value;
  const inflight = secretInflight.get(key);
  if (inflight) return inflight;
  const promise = Promise.resolve(control()
    .rpc('tenant_secret', { p_slug: slug, p_name: name }))
    .then(({ data, error }) => {
      if (error || typeof data !== 'string' || !data) throw new Error(`Secret ${key} is missing or unreadable`);
      secrets.set(key, { value: data, fetchedAt: now });
      return data;
    })
    .finally(() => {
      secretInflight.delete(key);
    });
  secretInflight.set(key, promise);
  return promise;
}

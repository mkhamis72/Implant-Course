import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { RegistryUnavailableError, type Tenant } from './types';

export const FRESH_MS = 60_000;
/** After this the cached registry is too old to route by: requests get "service unavailable". */
export const STALE_MS = 10 * 60_000;
export const CONTROL_TIMEOUT_MS = 3_000;
const SECRET_MS = 5 * 60_000;
const RETRY_MS = 15_000;

type Row = { slug: string; hosts: string[]; supabase_url: string; anon_key: string; status: 'active' | 'suspended' };

let cache: { tenants: Tenant[]; fetchedAt: number } | null = null;
const secrets = new Map<string, { value: string; fetchedAt: number }>();
let inflight: Promise<Tenant[]> | null = null;
const secretInflight = new Map<string, Promise<string>>();
let lastFailureAt: number | null = null;

export function resetControlCache(): void {
  cache = null;
  secrets.clear();
  inflight = null;
  secretInflight.clear();
  lastFailureAt = null;
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
  const { data, error } = await control().from('tenants').select('slug, hosts, supabase_url, anon_key, status');
  if (error || !data) throw new Error(error?.message ?? 'no data');
  return (data as Row[]).map((r) => ({
    slug: r.slug, hosts: r.hosts, supabaseUrl: r.supabase_url, anonKey: r.anon_key, status: r.status,
  }));
}

/** All companies from the control project: fresh for 60 s, then refetched; a failed refetch keeps the old list for 10 min. */
export async function controlTenants(now = Date.now()): Promise<Tenant[]> {
  if (cache && now - cache.fetchedAt < FRESH_MS) return cache.tenants;
  if (cache && lastFailureAt !== null && now - lastFailureAt < RETRY_MS && now - cache.fetchedAt < STALE_MS) {
    return cache.tenants;
  }
  if (inflight) return inflight;
  inflight = fetchTenants()
    .then((tenants) => {
      cache = { tenants, fetchedAt: now };
      lastFailureAt = null;
      return tenants;
    })
    .catch((error) => {
      lastFailureAt = now;
      if (cache && now - cache.fetchedAt < STALE_MS) {
        console.error('Tenant registry refresh failed; serving the cached registry', error);
        return cache.tenants;
      }
      throw new RegistryUnavailableError(error);
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
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

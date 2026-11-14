import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { createListCache } from './list-cache';
import type { Tenant } from './types';

/** Same budget as the control project's reads. */
const TIMEOUT_MS = 3_000;

type Row = { id: string; slug: string; hosts: string[] | null; status: 'active' | 'suspended' };

async function fetchCompanies(): Promise<Tenant[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are not set');
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) }) },
  });
  const { data, error } = await db.from('companies').select('id, slug, hosts, status');
  if (error || !data) throw new Error(error?.message ?? 'no data');
  return (data as Row[]).map((r): Tenant => ({
    slug: r.slug, hosts: r.hosts ?? [], supabaseUrl: url, anonKey, status: r.status, companyId: r.id,
  }));
}

const cache = createListCache(fetchCompanies);

/** Every company from the production database (merge release 2): one project, so the keys come from the env. */
export const productionTenants = (now?: number): Promise<Tenant[]> => cache.get(now);
export const resetProductionCache = (): void => cache.reset();

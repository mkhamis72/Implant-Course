import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { currentTenant } from '@/lib/tenant/current';
import { tenantServiceKey } from '@/lib/tenant/registry';
import { ADMIN_UNAVAILABLE } from '@/lib/tenant/types';

/** Service-role client for the current company. Use ONLY for auth admin operations (invite, ban); data writes go through the user's client so RLS and audit apply. */
export async function createAdminClient(): Promise<SupabaseClient> {
  const tenant = await currentTenant();
  let key: string;
  try {
    key = await tenantServiceKey(tenant.slug);
  } catch (error) {
    console.error(`Service key for ${tenant.slug} unavailable`, error);
    throw new Error(ADMIN_UNAVAILABLE);
  }
  return createClient(tenant.supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

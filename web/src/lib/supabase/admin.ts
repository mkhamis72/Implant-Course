import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { currentTenant } from '@/lib/tenant/current';
import { tenantServiceKey } from '@/lib/tenant/registry';
import { ADMIN_UNAVAILABLE, type Tenant } from '@/lib/tenant/types';

/** Service-role client for the current company. Use ONLY for auth admin operations (invite, ban); data writes go through the user's client so RLS and audit apply. */
export async function createAdminClient(): Promise<SupabaseClient> {
  let tenant: Tenant;
  let key: string;
  try {
    tenant = await currentTenant();
    key = await tenantServiceKey(tenant.slug);
  } catch (error) {
    console.error('Admin client unavailable', error);
    throw new Error(ADMIN_UNAVAILABLE);
  }
  return createClient(tenant.supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { currentTenant } from '@/lib/tenant/current';
import { requestDbToken } from '@/lib/self-auth/session';

/**
 * The company's PostgREST client. With a Self-Auth session, the request's database token is the bearer, so RLS
 * sees the signed-in user. Without one it uses the anon key (branding_for, branding_logo_for).
 */
export async function createClient() {
  const [tenant, token] = await Promise.all([currentTenant(), requestDbToken()]);
  return createSupabaseClient(tenant.supabaseUrl, tenant.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}),
  });
}

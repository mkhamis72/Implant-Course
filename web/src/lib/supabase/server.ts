import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Session } from '@mkhamis72/self-auth';
import { currentTenant } from '@/lib/tenant/current';
import { requestDbToken } from '@/lib/self-auth/session';
import { tenantAuth } from '@/lib/self-auth/tenant';

const options = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

/**
 * The company's PostgREST client. With a Self-Auth session, the request's database token is the bearer, so RLS
 * sees the signed-in user. Without one it uses the anon key (branding_for, branding_logo_for).
 */
export async function createClient() {
  const [tenant, token] = await Promise.all([currentTenant(), requestDbToken()]);
  return createSupabaseClient(tenant.supabaseUrl, tenant.anonKey, {
    auth: options,
    ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}),
  });
}

/**
 * A client for a session this very request just created or raised (sign-in, a verified code): the request's
 * own database token was minted before that and would still describe the old session.
 */
export async function createClientForSession(session: Session) {
  const [tenant, auth] = await Promise.all([currentTenant(), tenantAuth()]);
  const token = await auth.issueDbToken(session);
  return createSupabaseClient(tenant.supabaseUrl, tenant.anonKey, {
    auth: options,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

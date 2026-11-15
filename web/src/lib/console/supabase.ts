import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { consoleDbToken } from '@/lib/self-auth/console-session';
import { consoleConfig } from './env';

const options = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

/**
 * The signed-in console admin's PostgREST client on the company project: this request's database token (minted
 * from the Self-Auth console session) is the bearer, so is_console_user() sees the admin and their aal.
 */
export async function createConsoleClient(): Promise<SupabaseClient> {
  const { url, anonKey } = consoleConfig();
  const token = await consoleDbToken();
  return createClient(url, anonKey, {
    auth: options,
    ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}),
  });
}

/** Service access to the company project: only after requireConsoleAdmin(). */
export function createConsoleServiceClient(): SupabaseClient {
  const { url, serviceKey } = consoleConfig();
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

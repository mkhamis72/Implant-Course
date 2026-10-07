import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { controlConfig } from './env';

/** The signed-in console admin's session on the control project. */
export async function createConsoleClient(): Promise<SupabaseClient> {
  const { url, anonKey } = controlConfig();
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Component: read-only cookies; the middleware refreshes them.
        }
      },
    },
  });
}

/** Service access to the control project: only after requireConsoleAdmin(). */
export function createConsoleServiceClient(): SupabaseClient {
  const { url, serviceKey } = controlConfig();
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

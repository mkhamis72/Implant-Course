import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { currentTenant } from '@/lib/tenant/current';

export async function createClient() {
  const [cookieStore, tenant] = await Promise.all([cookies(), currentTenant()]);
  return createServerClient(tenant.supabaseUrl, tenant.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies are read-only there; middleware refreshes them.
        }
      },
    },
  });
}

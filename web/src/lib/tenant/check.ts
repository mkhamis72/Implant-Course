import { createClient } from '@supabase/supabase-js';

/** Problems with a company's URL and keys (empty when both the public and the service key work). */
export async function checkTenant(
  t: { supabaseUrl: string; anonKey: string; serviceRoleKey: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const problems: string[] = [];
  const res = await fetchImpl(`${t.supabaseUrl}/auth/v1/settings`, { headers: { apikey: t.anonKey } });
  if (!res.ok) problems.push(`Anon key rejected by ${t.supabaseUrl} (${res.status})`);
  const admin = createClient(t.supabaseUrl, t.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await admin.from('profiles').select('user_id').limit(1);
  if (error) problems.push(`Service key can't read profiles: ${error.message}`);
  return problems;
}

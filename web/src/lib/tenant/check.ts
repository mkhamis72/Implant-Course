import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const connectDefault = (url: string, key: string) => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

/** Problems with a company's URL and keys (empty when both the public and the service key work). */
export async function checkTenant(
  t: { supabaseUrl: string; anonKey: string; serviceRoleKey: string },
  fetchImpl: typeof fetch = fetch,
  connect: (url: string, key: string) => SupabaseClient = connectDefault,
): Promise<string[]> {
  const problems: string[] = [];
  const res = await fetchImpl(`${t.supabaseUrl}/auth/v1/settings`, { headers: { apikey: t.anonKey } });
  if (!res.ok) problems.push(`Anon key rejected by ${t.supabaseUrl} (${res.status})`);
  const admin = connect(t.supabaseUrl, t.serviceRoleKey);
  const { error } = await admin.from('profiles').select('user_id').limit(1);
  if (error) problems.push(`Service key can't read profiles: ${error.message}`);
  return problems;
}

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const connectDefault = (url: string, key: string) => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

/** Problems with a company's URL, keys and Auth settings (empty when both keys work and sign-ups are off). */
export async function checkTenant(
  t: { supabaseUrl: string; anonKey: string; serviceRoleKey: string },
  fetchImpl: typeof fetch = fetch,
  connect: (url: string, key: string) => SupabaseClient = connectDefault,
): Promise<string[]> {
  const problems: string[] = [];
  const res = await fetchImpl(`${t.supabaseUrl}/auth/v1/settings`, { headers: { apikey: t.anonKey } });
  if (!res.ok) problems.push(`Anon key rejected by ${t.supabaseUrl} (${res.status})`);
  // A pending login (0088) goes to whoever creates an auth.users row with its email: sign-ups must be off.
  else if ((await res.json().catch(() => null))?.disable_signup !== true) {
    problems.push(`Auth sign-ups are enabled on ${t.supabaseUrl}: turn off "Allow new users to sign up" (Authentication -> Sign In / Providers)`);
  }
  const admin = connect(t.supabaseUrl, t.serviceRoleKey);
  const { error } = await admin.from('profiles').select('user_id').limit(1);
  if (error) problems.push(`Service key can't read profiles: ${error.message}`);
  return problems;
}

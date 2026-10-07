import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { temporaryPassword } from '@/lib/admin/passwords';

/** Creates (or resets) a company's admin login with a one-time password; no half-made account on failure. */
export async function createFirstAdmin(company: SupabaseClient, a: { email: string; fullName: string }): Promise<{ password: string; created: boolean }> {
  const email = a.email.trim().toLowerCase();
  const password = temporaryPassword();
  const { data: existing } = await company.from('profiles').select('user_id').eq('email', email).maybeSingle();
  let userId: string;
  let created = false;
  if (existing?.user_id) {
    const { error } = await company.auth.admin.updateUserById(existing.user_id, { password, ban_duration: 'none' });
    if (error) throw new Error(`The password could not be reset: ${error.message}`);
    userId = existing.user_id;
  } else {
    const { data, error } = await company.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data?.user) throw new Error(`The login could not be created: ${error?.message ?? 'unknown error'}`);
    userId = data.user.id;
    created = true;
  }
  const { error: profileError } = await company.from('profiles').update({ full_name: a.fullName, role: 'admin', active: true, delegate_id: null }).eq('user_id', userId);
  if (profileError) {
    if (created) await company.auth.admin.deleteUser(userId);
    throw new Error(`The login was not finished: ${profileError.message}`);
  }
  return { password, created };
}

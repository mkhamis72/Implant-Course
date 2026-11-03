import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { temporaryPassword } from '@/lib/admin/passwords';

/** Makes someone a company's admin with a one-time password: an existing account gets the membership and a
 *  password reset, a new address gets a pending admin login (console_add_first_admin, 0093) and then its
 *  Auth account, which handle_new_user turns into the membership. `db` is the shared database's service role. */
export async function createFirstAdmin(
  db: SupabaseClient,
  a: { companyId: string; email: string; fullName: string },
): Promise<{ password: string; created: boolean }> {
  const email = a.email.trim().toLowerCase();
  const password = temporaryPassword();
  const { data: existing, error: lookupError } = await db.from('profiles').select('user_id').eq('email', email).limit(1);
  if (lookupError) throw new Error(`The login was not finished: ${lookupError.message}`);
  const { error: adminError } = await db.rpc('console_add_first_admin', { p_company: a.companyId, p_email: email, p_full_name: a.fullName });
  if (adminError) throw new Error(`The login was not finished: ${adminError.message}`);
  const userId = (existing as { user_id: string }[] | null)?.[0]?.user_id;
  if (userId) {
    const { error } = await db.auth.admin.updateUserById(userId, { password, ban_duration: 'none' });
    if (error) throw new Error(`The password could not be reset: ${error.message}`);
    return { password, created: false };
  }
  // A failure leaves the pending row; sign-ups are off, and it expires after 7 days (handle_new_user).
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data?.user) throw new Error(`The login could not be created: ${error?.message ?? 'unknown error'}`);
  return { password, created: true };
}

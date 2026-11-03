import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { temporaryPassword } from '@/lib/admin/passwords';

/** created: a new login with a one-time password. reset: the company's own existing login, with a new
 *  one-time password. added: an account another company also uses, which keeps its own password. */
export type FirstAdminResult =
  | { outcome: 'created' | 'reset'; password: string }
  | { outcome: 'added' };

/** Makes someone a company's admin: console_add_first_admin (0093) gives an existing account the membership,
 *  or writes a pending admin login for a new address that handle_new_user turns into the membership when the
 *  Auth account is created. `db` is the shared database's service role. */
export async function createFirstAdmin(
  db: SupabaseClient,
  a: { companyId: string; email: string; fullName: string },
): Promise<FirstAdminResult> {
  const email = a.email.trim().toLowerCase();
  const { data: existing, error: lookupError } = await db.from('profiles').select('user_id').eq('email', email).limit(1);
  if (lookupError) throw new Error(`The login was not finished: ${lookupError.message}`);
  const userId = (existing as { user_id: string }[] | null)?.[0]?.user_id;
  let shared = false;
  if (userId) {
    const { data: elsewhere, error } = await db.from('company_members').select('company_id')
      .eq('user_id', userId).neq('company_id', a.companyId).limit(1);
    if (error) throw new Error(`The login was not finished: ${error.message}`);
    shared = (elsewhere ?? []).length > 0;
  }
  const { error: adminError } = await db.rpc('console_add_first_admin', { p_company: a.companyId, p_email: email, p_full_name: a.fullName });
  if (adminError) throw new Error(`The login was not finished: ${adminError.message}`);

  if (userId && shared) {
    // Their password is used at another company too: never replace it from here. Only lift a ban.
    const { error } = await db.auth.admin.updateUserById(userId, { ban_duration: 'none' });
    if (error) throw new Error(`The login could not be unblocked: ${error.message}`);
    return { outcome: 'added' };
  }
  const password = temporaryPassword();
  if (userId) {
    const { error } = await db.auth.admin.updateUserById(userId, { password, ban_duration: 'none' });
    if (error) throw new Error(`The password could not be reset: ${error.message}`);
    return { outcome: 'reset', password };
  }
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data?.user) {
    // Without this, a later account for the address would become the company's admin unasked.
    const { error: cancelError } = await db.rpc('console_cancel_pending_login', { p_company: a.companyId, p_email: email });
    if (cancelError) console.warn('The pending admin login could not be removed:', cancelError.message);
    throw new Error(`The login could not be created: ${error?.message ?? 'unknown error'}`);
  }
  return { outcome: 'created', password };
}

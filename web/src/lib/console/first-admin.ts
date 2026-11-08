import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { temporaryPassword } from '@/lib/admin/passwords';
import { addedToCompanyNotice } from '@/lib/admin/notices';
import { sendEmail } from '@/lib/email/send';

/** created: a new login with a one-time password. reset: the company's own existing login, with a new
 *  one-time password. added: an account another company also uses, which keeps its own password. */
export type FirstAdminResult =
  | { outcome: 'created' | 'reset'; password: string }
  | { outcome: 'added' };

/** console_add_first_admin for the address, after finding out whether it already has a login (userId) and
 *  whether another company uses that login too (shared). */
async function makeAdmin(db: SupabaseClient, a: { companyId: string; email: string; fullName: string }) {
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
  return { email, userId, shared };
}

/** Makes someone a company's admin: console_add_first_admin (0093) gives an existing account the membership,
 *  or writes a pending admin login for a new address that handle_new_user turns into the membership when the
 *  Auth account is created. `db` is the shared database's service role. */
export async function createFirstAdmin(
  db: SupabaseClient,
  a: { companyId: string; email: string; fullName: string },
): Promise<FirstAdminResult> {
  const { email, userId, shared } = await makeAdmin(db, a);

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

/** invited: a new address got the invite email. reinvited: the company's own login that never confirmed got
 *  it again. reset_sent: the company's own confirmed login got a password-reset email. added: an account
 *  another company also uses keeps its password and gets a notice (noticeSent false when it could not go). */
export type InviteResult =
  | { outcome: 'invited' | 'reinvited' | 'reset_sent' }
  | { outcome: 'added'; noticeSent: boolean };

/**
 * The first admin by email (multi-tenant part 5): like createFirstAdmin, but no password passes through the
 * console. Every link opens on the company's own address (`origin`, e.g. https://acme.imploid.net), through
 * the invite / recovery templates' {{ .RedirectTo }}.
 */
export async function inviteFirstAdmin(
  db: SupabaseClient,
  a: { companyId: string; companyName: string; email: string; fullName: string; origin: string },
  send = sendEmail,
): Promise<InviteResult> {
  const { email, userId, shared } = await makeAdmin(db, a);
  const redirectTo = `${a.origin}/auth/confirm`;
  if (userId) {
    const { error } = await db.auth.admin.updateUserById(userId, { ban_duration: 'none' });
    if (error) throw new Error(`The login could not be unblocked: ${error.message}`);
  }
  if (userId && shared) {
    const noticeSent = (await send({ to: email, ...addedToCompanyNotice({ company: a.companyName }) })) === 'sent';
    return { outcome: 'added', noticeSent };
  }
  if (userId) {
    const { data, error } = await db.auth.admin.getUserById(userId);
    if (error || !data?.user) throw new Error(`The login could not be read: ${error?.message ?? 'not found'}`);
    if (data.user.email_confirmed_at) {
      const { error: resetError } = await db.auth.resetPasswordForEmail(email, { redirectTo });
      if (resetError) throw new Error(`The password-reset email could not be sent: ${resetError.message}`);
      return { outcome: 'reset_sent' };
    }
  }
  // Auth sends the invite again to an address that never confirmed, and refuses a confirmed one (handled above).
  const { error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (error) {
    if (!userId) {
      // Without this, a later account for the address would become the company's admin unasked.
      const { error: cancelError } = await db.rpc('console_cancel_pending_login', { p_company: a.companyId, p_email: email });
      if (cancelError) console.warn('The pending admin login could not be removed:', cancelError.message);
    }
    throw new Error(`The invite could not be sent: ${error.message}`);
  }
  return { outcome: userId ? 'reinvited' : 'invited' };
}

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { temporaryPassword } from '@/lib/admin/passwords';
import { tenantAuth } from '@/lib/self-auth/tenant';

/** created: a new account with a one-time password. reset: the company's own existing account, with a new one-time password. */
export type FirstAdminResult = { outcome: 'created' | 'reset'; password: string };

/** invited: a new address got the invite email. reinvited: the company's own account that never set a password got
 *  the link again. reset_sent: the company's own account got a password-reset email. */
export type InviteResult = { outcome: 'invited' | 'reinvited' | 'reset_sent' };

type Target = { companyId: string; email: string; fullName: string };

/** Only the error's code, never its message (a message could carry a password or a link). */
const codeOf = (e: unknown) => String((e as { code?: unknown } | null)?.code ?? (e instanceof Error ? e.name : 'error'));

/**
 * console_add_first_admin (0093) in the company's database: someone who already has a profile becomes an active
 * admin of the company (a membership); for a new address it writes the pending admin login that the Self-Auth
 * user trigger turns into the profile and membership when the account is created. `db` is the shared database's
 * service role. Returns the normalised address and the company's own account for it, if there is one.
 */
async function prepare(db: SupabaseClient, a: Target) {
  const email = a.email.trim().toLowerCase();
  const { error } = await db.rpc('console_add_first_admin', { p_company: a.companyId, p_email: email, p_full_name: a.fullName });
  if (error) throw new Error(`The login was not finished: ${error.message}`);
  const auth = await tenantAuth();
  let existing;
  try {
    existing = (await auth.admin.listUsers(a.companyId)).find((u) => u.email.toLowerCase() === email) ?? null;
  } catch (e) {
    // Without the answer the pending row could stay behind for good: take it back.
    await cancelPending(db, a.companyId, email);
    throw new Error(`The login could not be read: ${codeOf(e)}`);
  }
  // The company already has this account: a pending row the RPC wrote would only wait to turn a later account of
  // the address into an admin unasked.
  if (existing) await cancelPending(db, a.companyId, email);
  return { email, auth, existing };
}

/** Without this, a later account for the address would become the company's admin unasked. */
async function cancelPending(db: SupabaseClient, companyId: string, email: string) {
  try {
    const { error } = await db.rpc('console_cancel_pending_login', { p_company: companyId, p_email: email });
    if (error) console.warn('The pending admin login could not be removed:', error.message);
  } catch (e) {
    console.warn('The pending admin login could not be removed:', codeOf(e));
  }
}

/**
 * Makes someone a company's admin with a one-time password (email off): the pending row, then the account on that
 * company's Self-Auth. An existing account of the company gets a new password instead.
 */
export async function createFirstAdmin(db: SupabaseClient, a: Target): Promise<FirstAdminResult> {
  const { email, auth, existing } = await prepare(db, a);
  const password = temporaryPassword();
  if (existing) {
    try {
      await auth.admin.setPassword(a.companyId, existing.userId, password);
      if (existing.disabled) await auth.admin.setDisabled(a.companyId, existing.userId, false);
    } catch (e) {
      throw new Error(`The password could not be reset: ${codeOf(e)}`);
    }
    return { outcome: 'reset', password };
  }
  try {
    await auth.admin.createUser({ companyId: a.companyId, email, password });
  } catch (e) {
    await cancelPending(db, a.companyId, email);
    throw new Error(`The login could not be created: ${codeOf(e)}`);
  }
  return { outcome: 'created', password };
}

/**
 * The first admin by email: like createFirstAdmin, but no password passes through the console. Self-Auth emails
 * the link (to the company's own address, from the company id); it never reaches this code.
 */
export async function inviteFirstAdmin(db: SupabaseClient, a: Target): Promise<InviteResult> {
  const { email, auth, existing } = await prepare(db, a);
  if (existing) {
    try {
      if (existing.disabled) await auth.admin.setDisabled(a.companyId, existing.userId, false);
      // The reset link is also how an account without a password gets its first one.
      await auth.requestPasswordReset({ companyId: a.companyId, email });
    } catch (e) {
      throw new Error(`The password-reset email could not be sent: ${codeOf(e)}`);
    }
    return { outcome: existing.hasPassword ? 'reset_sent' : 'reinvited' };
  }
  try {
    await auth.admin.invite({ companyId: a.companyId, email });
  } catch (e) {
    await cancelPending(db, a.companyId, email);
    throw new Error(`The invite could not be sent: ${codeOf(e)}`);
  }
  return { outcome: 'invited' };
}

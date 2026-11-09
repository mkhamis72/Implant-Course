import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { tenantAuth } from '@/lib/self-auth/tenant';
import { currentTenant } from '@/lib/tenant/current';
import { userMessage } from '@/lib/db-errors';
import { emailEnabled } from '@/lib/flags';
import { temporaryPassword } from './passwords';
import type { Role } from '@/lib/auth/permissions';

const EXISTS = 'A user with this email already exists.';
export type LoginResult = { ok: string; password?: string } | { error: string };

/**
 * A new sign-in for this company (accounts are per company: someone who belongs to another company gets their own
 * account here). It takes its company, role and name from the pending row, which comes first: Migration A's trigger
 * makes the profile and membership as Self-Auth creates the account.
 * Email on: an invitation, emailed by Self-Auth (it holds the link; it is never returned here).
 * Email off (pilot without SMTP): an account with a one-time password for the admin to hand over.
 */
export async function createLogin(a: { email: string; full_name: string; role: Role; delegate_id?: string | null }): Promise<LoginResult> {
  const email = a.email.trim().toLowerCase();
  // Through the admin's own session: the definers act on its bound company, and the audit log records who did it.
  const supabase = await createClient();
  const { error: pendingError } = await supabase.rpc('create_pending_login', {
    p_email: email, p_full_name: a.full_name, p_role: a.role, p_delegate_id: a.delegate_id ?? null,
  });
  if (pendingError) return { error: userMessage(pendingError) ?? 'Could not create the login.' };

  // Every failure from here removes the pending row again: a later sign-up of the address mustn't join unasked.
  const cancel = async (result: { error: string }) => {
    try {
      const { error } = await supabase.rpc('cancel_pending_login', { p_email: email });
      if (error) console.warn(`The pending login for ${email} could not be removed: ${error.message}`);
    } catch (error) {
      console.warn(`The pending login for ${email} could not be removed: ${(error as Error).message}`);
    }
    return result;
  };

  const password = emailEnabled() ? undefined : temporaryPassword();
  try {
    const { companyId } = await currentTenant();
    const auth = await tenantAuth();
    if (password) await auth.admin.createUser({ companyId, email, password });
    else await auth.admin.invite({ companyId, email });
  } catch (e) {
    const code = (e as { code?: unknown } | null)?.code;
    if (code === 'email_taken') return cancel({ error: EXISTS });
    console.error('Creating the login failed:', e instanceof Error ? e.name : 'error');
    return cancel({ error: 'Could not create the login.' });
  }

  return password ? { ok: `Login created for ${email}.`, password } : { ok: `Invitation sent to ${email}.` };
}

import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { requestOrigin } from '@/lib/tenant/current';
import { mapAuthError } from '@/lib/auth/errors';
import { userMessage } from '@/lib/db-errors';
import { sendEmail } from '@/lib/email/send';
import { getBranding } from '@/lib/branding/get';
import { emailEnabled } from '@/lib/flags';
import { addedToCompanyNotice } from './notices';
import { temporaryPassword } from './passwords';
import type { Role } from '@/lib/auth/permissions';

const CHECK_FAILED = 'Could not check this email. Try again.';
const EXISTS = 'A user with this email already exists.';
export type LoginResult = { ok: string; password?: string } | { error: string };

/**
 * Someone with an account (another company's login) joins this company and keeps their password (an Auth ban
 * left from a deactivation elsewhere is lifted).
 * Otherwise a new account, which takes its company, role and name from the pending row:
 * email on: an invitation, whose link verifies the address and lets the user set a password;
 * email off (pilot without SMTP): a confirmed account with a one-time password for the admin to hand over.
 */
export async function createLogin(a: { email: string; full_name: string; role: Role; delegate_id?: string | null }): Promise<LoginResult> {
  const email = a.email.trim().toLowerCase();
  let admin;
  try {
    admin = await createAdminClient();
  } catch (error) {
    return { error: (error as Error).message };
  }
  // Any company's profile with this address (the admin client sees all): Auth would hand back that account.
  const { data: anywhere, error: anywhereError } = await admin.from('profiles').select('user_id').eq('email', email).limit(1);
  if (anywhereError) return { error: CHECK_FAILED };

  // Through the admin's own session: the definers act on its bound company, and the audit log records who did it.
  const supabase = await createClient();
  if (anywhere?.length) {
    const { data: userId, error } = await supabase.rpc('add_existing_member', { p_email: email, p_role: a.role, p_delegate_id: a.delegate_id ?? null });
    if (error) return { error: userMessage(error) ?? 'Could not add this user.' };
    // An account deactivated everywhere earlier is banned in Auth; active here now, it must be able to sign in.
    try {
      const { error: unbanError } = await admin.auth.admin.updateUserById(userId as string, { ban_duration: 'none' });
      if (unbanError) console.warn(`The sign-in ban on ${email} could not be lifted: ${unbanError.message}`);
    } catch (e) {
      console.warn(`The sign-in ban on ${email} could not be lifted: ${(e as Error).message}`);
    }
    const sent = await sendEmail({ to: email, ...addedToCompanyNotice({ company: (await getBranding()).name }) });
    if (sent === 'failed') console.warn(`The added-to-company notice to ${email} could not be sent.`);
    return { ok: `Added ${email} to this company. They sign in with their existing password.` };
  }

  // The pending row first: the new account's membership is made from it as Auth creates the account.
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
  const startedAt = Date.now();
  let created;
  try {
    created = password
      ? await admin.auth.admin.createUser({ email, password, email_confirm: true })
      : await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${await requestOrigin()}/auth/confirm` });
  } catch (error) {
    console.error('Creating the login failed:', (error as Error).message);
    return cancel({ error: 'Could not create the login.' });
  }
  const { data, error } = created;
  if (error || !data?.user) return cancel({ error: error ? mapAuthError(error) : 'Could not create the login.' });

  // Backstop: an account created before this call is an existing one (an invite returns it instead of failing).
  if (data.user.created_at && Date.parse(data.user.created_at) < startedAt - 5000) return cancel({ error: EXISTS });

  return password
    ? { ok: `Login created for ${email}.`, password }
    : { ok: `Invitation sent to ${email}. The link verifies their email address.` };
}

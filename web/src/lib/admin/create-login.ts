import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { serverEnv } from '@/lib/env';
import { mapAuthError } from '@/lib/auth/errors';
import { updateProblem } from './results';
import { emailEnabled } from '@/lib/flags';
import { temporaryPassword } from './passwords';
import type { Role } from '@/lib/auth/permissions';

export type LoginResult = { ok: string; password?: string } | { error: string };

/**
 * Email on: an invitation, whose link verifies the address and lets the user set a password.
 * Email off (pilot without SMTP): a confirmed account with a one-time password for the admin to hand over.
 */
export async function createLogin(a: { email: string; full_name: string; role: Role; delegate_id?: string | null }): Promise<LoginResult> {
  const admin = createAdminClient();
  const password = emailEnabled() ? undefined : temporaryPassword();
  const { data, error } = password
    ? await admin.auth.admin.createUser({ email: a.email, password, email_confirm: true })
    : await admin.auth.admin.inviteUserByEmail(a.email, { redirectTo: `${serverEnv().siteUrl}/auth/confirm` });
  if (error || !data?.user) return { error: error ? mapAuthError(error) : 'Could not create the login.' };

  // Through the admin's own session so RLS and the audit log record who did it.
  const supabase = await createClient();
  const problem = updateProblem(
    await supabase
      .from('profiles')
      .update({ full_name: a.full_name, role: a.role, delegate_id: a.delegate_id ?? null, active: true })
      .eq('user_id', data.user.id)
      .select('user_id'),
  );
  if (problem) {
    // Don't leave a half-made account behind: it would land on "Account deactivated".
    await admin.auth.admin.deleteUser(data.user.id);
    return { error: `The login was not created: ${problem}` };
  }
  return password
    ? { ok: `Login created for ${a.email}.`, password }
    : { ok: `Invitation sent to ${a.email}. The link verifies their email address.` };
}

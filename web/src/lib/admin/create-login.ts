import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { requestOrigin } from '@/lib/tenant/current';
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
  const email = a.email.trim().toLowerCase();
  const supabase = await createClient();
  // An invite to an existing, unconfirmed address returns that account instead of failing: never repurpose it.
  const { data: taken } = await supabase.from('profiles').select('user_id').eq('email', email).limit(1);
  if (taken?.length) return { error: 'A user with this email already exists.' };

  let admin;
  try {
    admin = await createAdminClient();
  } catch (error) {
    return { error: (error as Error).message };
  }
  const password = emailEnabled() ? undefined : temporaryPassword();
  const { data, error } = password
    ? await admin.auth.admin.createUser({ email, password, email_confirm: true })
    : await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${await requestOrigin()}/auth/confirm` });
  if (error || !data?.user) return { error: error ? mapAuthError(error) : 'Could not create the login.' };

  // An invite to an address that already has a set-up account (another company's, once the database is shared)
  // returns that account: never take it over. A new login only has the blank inactive row the signup trigger made.
  const { data: existing } = await admin.from('profiles').select('active, full_name').eq('user_id', data.user.id).maybeSingle();
  if (existing && (existing.active || existing.full_name !== '')) return { error: 'A user with this email already exists.' };

  // Through the admin's own session so RLS and the audit log record who did it.
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
    ? { ok: `Login created for ${email}.`, password }
    : { ok: `Invitation sent to ${email}. The link verifies their email address.` };
}

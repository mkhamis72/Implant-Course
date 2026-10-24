'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/session';
import { mapAuthError } from '@/lib/auth/errors';
import {
  changeEmailSchema, editNameSchema, inviteSchema, permissionsSchema, setActiveSchema, setRoleSchema, type ActionState,
} from '@/lib/admin/schemas';
import { createLogin } from '@/lib/admin/create-login';
import { userMessage } from '@/lib/db-errors';
import { updateProblem } from '@/lib/admin/results';
import { changeAuthEmail, deleteAuthUser, inviteLink, resetAuthFactors, setTemporaryPassword } from '@/lib/admin/auth-accounts';
import { emailChangedNotice, inviteEmail } from '@/lib/admin/notices';
import { sendEmail } from '@/lib/email/send';
import { getBranding } from '@/lib/branding/get';
import { emailEnabled } from '@/lib/flags';
import type { FormState } from '@/lib/patients/form-state';
import { z } from 'zod';

/** Email on: an invitation that verifies the address. Email off: a login with a one-time password. */
export async function inviteUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const result = await createLogin(parsed.data);
  if ('error' in result) return result;
  revalidatePath('/admin/users');
  return result;
}

export async function savePermissions(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = permissionsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Choose None, View or Edit for every panel.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_user_permissions', { p_user: parsed.data.user_id, p_perms: parsed.data.perms });
  if (error) return { error: userMessage(error)! };
  revalidatePath('/admin/users');
  return { ok: 'Permissions saved.' };
}

export async function setUserRole(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireAdmin();
  const parsed = setRoleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Invalid request.' };
  if (parsed.data.user_id === me.user_id) return { error: 'You cannot change your own role.' };
  const supabase = await createClient();
  const problem = updateProblem(
    await supabase.from('profiles').update({ role: parsed.data.role }).eq('user_id', parsed.data.user_id).select('user_id'),
  );
  if (problem) return { error: problem };
  revalidatePath('/admin/users');
  return { ok: 'Role updated.' };
}

export async function setUserActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireAdmin();
  const parsed = setActiveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Invalid request.' };
  const { user_id, active } = parsed.data;
  if (user_id === me.user_id) return { error: 'You cannot deactivate your own account.' };

  const supabase = await createClient();
  const problem = updateProblem(
    await supabase.from('profiles').update({ active }).eq('user_id', user_id).select('user_id'),
  );
  if (problem) return { error: problem };

  // Ban/unban in Auth so a deactivated user cannot sign in or refresh their session.
  let admin;
  try {
    admin = await createAdminClient();
  } catch (error) {
    return { error: (error as Error).message };
  }
  const { error: banError } = await admin.auth.admin.updateUserById(user_id, {
    ban_duration: active ? 'none' : '876000h',
  });
  if (banError) return { error: mapAuthError(banError) };

  revalidatePath('/admin/users');
  return { ok: active ? 'User reactivated.' : 'User deactivated.' };
}

/** Removes a user without records (test or mistaken accounts); the database refuses anyone with records. */
export async function removeUser(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('delete_user', { p_user: id.data });
  if (error) return { error: userMessage(error)! };
  const authError = await deleteAuthUser(id.data);
  revalidatePath('/admin/users');
  return authError ? { error: authError } : { ok: 'User removed.' };
}

/** A new one-time password for someone who lost theirs (works with email on or off). */
export async function resetPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireAdmin();
  const userId = String(formData.get('user_id') ?? '');
  if (userId === me.user_id) return { error: 'Change your own password under Account security.' };
  if (!z.string().uuid().safeParse(userId).success) return { error: 'Invalid request.' };
  const result = await setTemporaryPassword(userId);
  if ('error' in result) return result;
  return { ok: 'New one-time password set.', password: result.password };
}

const SELF_MESSAGE = "You can't do this to your own account here. Use Account → Security.";
type Db = Awaited<ReturnType<typeof createClient>>;

/** Signs the user out everywhere, last step of a change. Returns the message for a failure, or null. */
async function endSessions(supabase: Db, userId: string): Promise<string | null> {
  const { error } = await supabase.rpc('admin_end_sessions', { p_user: userId });
  return error ? `Changed, but existing sessions could not be ended: ${error.message}` : null;
}

/**
 * Auth first (where duplicates usually fail), then the app record; a failed app step puts the old address back
 * in Auth. Then sessions end and the notices go out (a failed notice only warns).
 */
export async function changeEmail(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireAdmin();
  if (formData.get('user_id') === me.user_id) return { error: SELF_MESSAGE };
  const parsed = changeEmailSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { user_id, email } = parsed.data;

  const changed = await changeAuthEmail(user_id, email);
  if ('error' in changed) return changed;
  const { previous } = changed;

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_change_email', { p_user: user_id, p_email: email });
  if (error) {
    const undone = await changeAuthEmail(user_id, previous.email);
    if ('error' in undone) {
      await supabase.rpc('admin_record_event', { p_user: user_id, p_kind: 'email_change_incomplete' });
      return { error: `The sign-in email was changed to ${email} but the app record wasn't. Ask your developer to fix user ${user_id}.` };
    }
    return { error: userMessage(error)! };
  }
  revalidatePath('/admin/users');

  const sessionProblem = await endSessions(supabase, user_id);
  // The old address only if they ever signed in with it: otherwise it was probably a typo.
  const notice = emailChangedNotice({ company: (await getBranding()).name, newEmail: email });
  const unsent: string[] = [];
  for (const to of previous.signedInBefore ? [email, previous.email] : [email]) {
    if ((await sendEmail({ to, ...notice })) === 'failed') unsent.push(to);
  }
  const warning = unsent.length ? ` The notice to ${unsent.join(' and ')} couldn't be sent.` : '';
  return sessionProblem ? { error: sessionProblem + warning } : { ok: `Email changed to ${email}.${warning}` };
}

/** Removes every factor, then requires set-up again before the user can work, then signs them out everywhere. */
export async function resetTwoFactor(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireAdmin();
  const userId = String(formData.get('user_id') ?? '');
  if (userId === me.user_id) return { error: SELF_MESSAGE };
  if (!z.string().uuid().safeParse(userId).success) return { error: 'Invalid request.' };

  const problem = await resetAuthFactors(userId);
  if (problem) return { error: problem };
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_require_mfa_setup', { p_user: userId });
  if (error) {
    return { error: `Two-factor authentication was removed, but setting it up again couldn't be required: ${userMessage(error)}` };
  }
  revalidatePath('/admin/users');
  const sessionProblem = await endSessions(supabase, userId);
  return sessionProblem
    ? { error: sessionProblem }
    : { ok: 'Two-factor authentication reset. They must set it up again when they next sign in.' };
}

/** Any user's name, your own included. */
export async function editName(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = editNameSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_name', { p_user: parsed.data.user_id, p_name: parsed.data.full_name });
  if (error) return { error: userMessage(error)! };
  revalidatePath('/admin/users');
  return { ok: 'Name saved.' };
}

/** A new invitation email for someone who never signed in (email on only). */
export async function resendInvite(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  if (!emailEnabled()) return { error: "Email is off, so invites can't be resent. Use Reset password instead." };
  const userId = String(formData.get('user_id') ?? '');
  if (!z.string().uuid().safeParse(userId).success) return { error: 'Invalid request.' };

  const invite = await inviteLink(userId);
  if ('error' in invite) return invite;
  const sent = await sendEmail({ to: invite.email, ...inviteEmail({ company: (await getBranding()).name, link: invite.link }) });
  if (sent === 'not-configured') return { error: "The app's email (SMTP) isn't set up, so the invite couldn't be sent." };
  if (sent === 'failed') return { error: "The invite couldn't be sent. Try again, or use Reset password." };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_record_event', { p_user: userId, p_kind: 'invite_resent' });
  // The email is out either way; only the history line is missing.
  if (error) console.error('Recording invite_resent failed:', error.message);
  revalidatePath('/admin/users');
  return { ok: `Invitation sent again to ${invite.email}.` };
}

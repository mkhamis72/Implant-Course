'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import {
  changeEmailSchema, editNameSchema, inviteDoctor, inviteSchema, permissionsSchema, setActiveSchema, setRoleSchema, type ActionState,
} from '@/lib/admin/schemas';
import { createLogin } from '@/lib/admin/create-login';
import { teachingOn } from '@/lib/modules/modules';
import { userMessage } from '@/lib/db-errors';
import {
  changeAuthEmail, deleteAuthUser, hasVerifiedFactor, listAccounts, resetAuthFactors, sendPasswordLink, setAuthDisabled, setOneTimePassword, unlinkGoogle,
} from '@/lib/admin/auth-accounts';
import { memberOfMyCompany, profileRemains, USER_NOT_FOUND } from '@/lib/admin/same-company';
import { currentTenant } from '@/lib/tenant/current';
import { emailChangedNotice } from '@/lib/admin/notices';
import { sendEmail } from '@/lib/email/send';
import { getBranding } from '@/lib/branding/get';
import { emailEnabled } from '@/lib/flags';
import type { FormState } from '@/lib/patients/form-state';
import { z } from 'zod';

/**
 * Email on: an invitation that verifies the address. Email off: a login with a one-time password.
 * In a clinic, a Doctor (or an Admin who is also a doctor) is linked to a doctor.
 */
export async function inviteUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireAdmin();
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { email, full_name, role } = parsed.data;
  // Only a clinic links a doctor to a new login.
  const clinic = !teachingOn(me.features);
  const result = await createLogin(clinic ? { email, full_name, role, ...inviteDoctor(parsed.data, true) } : { email, full_name, role });
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
  if (!(await memberOfMyCompany(parsed.data.user_id))) return { error: USER_NOT_FOUND };
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_member_role', { p_user: parsed.data.user_id, p_role: parsed.data.role });
  if (error) return { error: userMessage(error)! };
  revalidatePath('/admin/users');
  return { ok: 'Role updated.' };
}

export async function setUserActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireAdmin();
  const parsed = setActiveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Invalid request.' };
  const { user_id, active } = parsed.data;
  if (user_id === me.user_id) return { error: 'You cannot deactivate your own account.' };
  if (!(await memberOfMyCompany(user_id))) return { error: USER_NOT_FOUND };

  const supabase = await createClient();
  const { error } = await supabase.rpc('set_member_active', { p_user: user_id, p_active: active });
  if (error) return { error: userMessage(error)! };

  // Disable/enable this company's own sign-in account (accounts are per company, so other companies are untouched).
  // Deactivating also ends the account's sessions, so the user is out at once.
  const authError = await setAuthDisabled(user_id, !active);
  if (authError) return { error: authError };

  revalidatePath('/admin/users');
  return { ok: active ? 'User reactivated.' : 'User deactivated.' };
}

/** Removes a user without records (test or mistaken accounts); the database refuses anyone with records. */
export async function removeUser(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Invalid request.' };
  if (!(await memberOfMyCompany(id.data))) return { error: USER_NOT_FOUND };
  const supabase = await createClient();
  const { error } = await supabase.rpc('delete_user', { p_user: id.data });
  if (error) return { error: userMessage(error)! };
  revalidatePath('/admin/users');
  // delete_user keeps the profile of someone another company still has: their sign-in stays too.
  const remains = await profileRemains(id.data);
  if (remains === null) {
    return { error: "The user was removed from this company, but it couldn't be checked whether their sign-in account can be deleted." };
  }
  if (remains) return { ok: 'User removed.' };
  const authError = await deleteAuthUser(id.data);
  return authError ? { error: authError } : { ok: 'User removed.' };
}

/**
 * Email on: emails the user a link to set a new password (the admin never sees it). Email off: sets a one-time
 * password, ends the member's sessions, and returns the password for the admin to hand over (shown once).
 */
export async function resetPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireAdmin();
  const userId = String(formData.get('user_id') ?? '');
  if (userId === me.user_id) return { error: 'Change your own password under Account security.' };
  if (!z.string().uuid().safeParse(userId).success) return { error: 'Invalid request.' };
  if (!(await memberOfMyCompany(userId))) return { error: USER_NOT_FOUND };
  if (emailEnabled()) {
    const sent = await sendPasswordLink(userId);
    if ('error' in sent) return sent;
    return { ok: `Password reset email sent to ${sent.email}.` };
  }
  const result = await setOneTimePassword(userId);
  if ('error' in result) return result;
  // Self-Auth ended its own sessions; this ends the ones bound to the company's database as well.
  const problem = await endSessions(await createClient(), userId);
  return {
    ok: problem ? `New one-time password set, but existing sessions could not be ended: ${problem}` : 'New one-time password set. Everywhere they were signed in, they are signed out.',
    password: result.password,
  };
}

const SELF_MESSAGE = "You can't do this to your own account here. Use Account → Security.";
type Db = Awaited<ReturnType<typeof createClient>>;
/** Ids compared as uuids: an upper-cased copy of your own id is still you. */
const isSelf = (userId: string, myId: string) => userId.toLowerCase() === myId.toLowerCase();

/** Signs the user out everywhere, last step of a change. Returns the database error for a failure, or null. */
async function endSessions(supabase: Db, userId: string): Promise<string | null> {
  const { error } = await supabase.rpc('admin_end_sessions', { p_user: userId });
  return error ? error.message : null;
}

function sessionsMessage(problem: string): string {
  return `Changed, but existing sessions could not be ended: ${problem}`;
}

/**
 * Auth first (where duplicates usually fail), then the app record; a failed app step puts the old address back
 * in Auth. Then sessions end and the notices go out (a failed notice only warns).
 */
export async function changeEmail(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireAdmin();
  const parsed = changeEmailSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { user_id, email } = parsed.data;
  if (isSelf(user_id, me.user_id)) return { error: SELF_MESSAGE };

  if (!(await memberOfMyCompany(user_id))) return { error: USER_NOT_FOUND };

  const changed = await changeAuthEmail(user_id, email);
  if ('error' in changed) return changed;
  const { previous } = changed;

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_change_email', { p_user: user_id, p_email: email });
  if (error) {
    const undone = await changeAuthEmail(user_id, previous.email);
    if ('error' in undone) {
      const { error: eventError } = await supabase.rpc('admin_record_event', { p_user: user_id, p_kind: 'email_change_incomplete' });
      if (eventError) console.error('Recording email_change_incomplete failed:', eventError.message);
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
  return sessionProblem ? { error: sessionsMessage(sessionProblem) + warning } : { ok: `Email changed to ${email}.${warning}` };
}

/** Forgets the user's linked Google identity, so their next Google sign-in is remembered instead. */
export async function resetGoogle(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireAdmin();
  const userId = String(formData.get('user_id') ?? '');
  if (!z.string().uuid().safeParse(userId).success) return { error: 'Invalid request.' };
  if (isSelf(userId, me.user_id)) return { error: SELF_MESSAGE };
  if (!(await memberOfMyCompany(userId))) return { error: USER_NOT_FOUND };
  const problem = await unlinkGoogle(userId);
  if (problem) return { error: problem };
  revalidatePath('/admin/users');
  return { ok: 'Google sign-in reset. Their next Google sign-in is remembered instead.' };
}

/** Requires set-up again before the user can work, then removes every factor, then signs them out everywhere. */
export async function resetTwoFactor(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireAdmin();
  const userId = String(formData.get('user_id') ?? '');
  if (!z.string().uuid().safeParse(userId).success) return { error: 'Invalid request.' };
  if (isSelf(userId, me.user_id)) return { error: SELF_MESSAGE };

  if (!(await memberOfMyCompany(userId))) return { error: USER_NOT_FOUND };

  // Not a way to require 2FA of someone who never set it up, except to retry a reset that half-failed.
  const factor = await hasVerifiedFactor(userId);
  if (factor === null) return { error: "Couldn't check this user's two-factor authentication. Try again." };
  const supabase = await createClient();
  if (!factor) {
    const { companyId } = await currentTenant();
    const { data: target } = await supabase
      .from('company_members')
      .select('mfa_setup_required')
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!target?.mfa_setup_required) return { error: 'This user has no two-factor authentication to reset.' };
  }
  // The flag first: whatever fails after it, the user can't work without setting up 2FA again.
  const { error } = await supabase.rpc('admin_require_mfa_setup', { p_user: userId });
  if (error) return { error: userMessage(error)! };
  revalidatePath('/admin/users');
  const problem = await resetAuthFactors(userId);
  // Always end the sessions once flagged: a session left on the lost phone mustn't keep working.
  const sessionProblem = await endSessions(supabase, userId);
  if (problem) {
    const factorsMessage = `Setting up two-factor authentication again is now required, but the old authenticator couldn't be removed: ${problem} Try Reset 2FA again.`;
    return {
      error: sessionProblem
        ? `${factorsMessage} Existing sessions could not be ended either: ${sessionProblem}`
        : factorsMessage,
    };
  }
  return sessionProblem
    ? { error: sessionsMessage(sessionProblem) }
    : { ok: 'Two-factor authentication reset. They must set it up again when they next sign in.' };
}

/** Any user's name, your own included. */
export async function editName(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = editNameSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!(await memberOfMyCompany(parsed.data.user_id))) return { error: USER_NOT_FOUND };
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_set_name', { p_user: parsed.data.user_id, p_name: parsed.data.full_name });
  if (error) return { error: userMessage(error)! };
  revalidatePath('/admin/users');
  return { ok: 'Name saved.' };
}

/** The invitation again, for someone who hasn't set a password yet (email on only): Self-Auth emails them a link. */
export async function resendInvite(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  if (!emailEnabled()) return { error: "Email is off, so invites can't be resent. Create the login again with a one-time password." };
  const userId = String(formData.get('user_id') ?? '');
  if (!z.string().uuid().safeParse(userId).success) return { error: 'Invalid request.' };
  if (!(await memberOfMyCompany(userId))) return { error: USER_NOT_FOUND };

  const accounts = await listAccounts().catch(() => null);
  if (!accounts) return { error: "Couldn't check this account. Try again." };
  const account = accounts.get(userId);
  if (!account) return { error: USER_NOT_FOUND };
  if (account.hasPassword) return { error: 'This user has already accepted the invite. Use Reset password instead.' };
  if (account.hasGoogle) return { error: 'This user has already accepted the invite by signing in with Google.' };
  const sent = await sendPasswordLink(userId);
  if ('error' in sent) return sent;

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_record_event', { p_user: userId, p_kind: 'invite_resent' });
  // The email is out either way; only the history line is missing.
  if (error) console.error('Recording invite_resent failed:', error.message);
  revalidatePath('/admin/users');
  return { ok: `Invitation sent again to ${sent.email}.` };
}

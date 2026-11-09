'use server';

import { revalidatePath } from 'next/cache';
import QRCode from 'qrcode';
import { createClient, createClientForSession } from '@/lib/supabase/server';
import { GENERIC_AUTH_ERROR, mapAuthError } from '@/lib/auth/errors';
import { requireSignedIn } from '@/lib/auth/session';
import { createLimiter } from '@/lib/auth/rate-limit';
import { FORGOT_TOO_MANY } from '@/lib/auth/password-reset';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/link-password';
import { emailEnabled } from '@/lib/flags';
import { userMessage } from '@/lib/db-errors';
import { readSessionCookie } from '@/lib/self-auth/cookie';
import { tenantAuth } from '@/lib/self-auth/tenant';
import { currentTenant } from '@/lib/tenant/current';

// factorId is a placeholder: Self-Auth keeps one authenticator per account, and the shared enrolment form
// (also used by the console) passes it back.
export type Enrollment = { factorId: string; qrCode: string; secret: string };

/** The signed-in user's session token and this host's company, for the calls that need both. */
async function sessionContext() {
  await requireSignedIn({ allowMfaSetup: true });
  const [token, { companyId }] = await Promise.all([readSessionCookie('tenant'), currentTenant()]);
  if (!token) throw new Error('Not signed in');
  return { token, companyId, auth: await tenantAuth() };
}

export async function startEnroll(): Promise<Enrollment | { error: string }> {
  const { token, companyId, auth } = await sessionContext();
  try {
    // Replaces an unconfirmed secret; a confirmed authenticator must be removed first.
    const { secret, otpauthUrl } = await auth.totp.startEnroll(token, companyId);
    const qrCode = await QRCode.toDataURL(otpauthUrl, { width: 180, margin: 1 });
    return { factorId: 'totp', qrCode, secret };
  } catch (e) {
    if ((e as { code?: string }).code === 'totp_already_enrolled') return { error: 'An authenticator is already set up.' };
    return { error: GENERIC_AUTH_ERROR };
  }
}

export async function confirmEnroll(_factorId: string, code: string): Promise<{ ok: true } | { error: string }> {
  const { token, companyId, auth } = await sessionContext();
  const session = await auth.totp.confirmEnroll(token, companyId, code.replace(/\s/g, ''));
  if (!session) return { error: mapAuthError('mfa_verification_failed') };
  // The verify raised this session to aal2, which mfa_setup_done checks: it clears an admin's "must set up
  // 2FA again" (a no-op for everyone else). This request's own database token still says aal1, so mint one for
  // the raised session.
  const supabase = await createClientForSession(session);
  const { error: doneError } = await supabase.rpc('mfa_setup_done');
  if (doneError) return { error: userMessage(doneError)! };
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function removeFactor(): Promise<void> {
  const { token, companyId, auth } = await sessionContext();
  // Self-Auth removes it only from an aal2 session, as before.
  if (!(await auth.totp.remove(token, companyId))) throw new Error(GENERIC_AUTH_ERROR);
  revalidatePath('/account/security');
}

/**
 * For a user who must set up 2FA again but already has a verified factor (the clear after their verify was refused,
 * or an old factor survived a reset): clears the flag at aal2, which mfa_setup_done checks.
 */
export async function finishMfaSetup(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('mfa_setup_done');
  if (error) return { error: userMessage(error)! };
  revalidatePath('/', 'layout');
  return {};
}

export type ChangePasswordState = { ok?: string; error?: string };

/**
 * Self-service change with the current password, for everyone (email on or off). Wrong guesses count toward the
 * sign-in lockout in Self-Auth. Every other session of the user ends; this one stays.
 */
export async function changeOwnPassword(_prev: ChangePasswordState, formData: FormData): Promise<ChangePasswordState> {
  const current = String(formData.get('current') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  const { token, companyId, auth } = await sessionContext();
  if (!current) return { error: 'Enter your current password.' };
  if (password.length < MIN_PASSWORD_LENGTH) return { error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
  if (password !== confirm) return { error: 'The passwords do not match.' };
  let changed: boolean;
  try {
    changed = await auth.changePassword(token, companyId, current, password);
  } catch (e) {
    if ((e as { code?: string }).code === 'weak_password') return { error: `Use ${MIN_PASSWORD_LENGTH} to 128 characters.` };
    console.error('changeOwnPassword failed', e instanceof Error ? e.name : 'error');
    return { error: GENERIC_AUTH_ERROR };
  }
  if (!changed) return { error: 'Your current password is not correct, or there were too many attempts. Try again later.' };
  return { ok: 'Your password was changed. Other devices were signed out.' };
}

const perUser = createLimiter(3, 15 * 60_000);

/** "Forgot your password?": the signed-in user asks for a reset link to their own address. */
export async function emailPasswordLink(): Promise<{ sent?: string; error?: string }> {
  const profile = await requireSignedIn({ allowMfaSetup: true });
  if (!emailEnabled()) return { error: 'Email is not available. Ask an admin to reset your password.' };
  const { companyId } = await currentTenant();
  if (!perUser.allow(`${companyId}|${profile.user_id}`)) return { error: FORGOT_TOO_MANY };
  try {
    await (await tenantAuth()).requestPasswordReset({ companyId, email: profile.email });
  } catch (e) {
    console.error('emailPasswordLink failed', e instanceof Error ? e.name : 'error');
  }
  return { sent: 'We emailed a link to your address. It works for 24 hours.' };
}

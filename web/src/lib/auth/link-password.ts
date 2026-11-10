import 'server-only';
import { redirect } from 'next/navigation';
import { mapAuthError } from '@/lib/auth/errors';
import { tenantAuth } from '@/lib/self-auth/tenant';
import { currentTenant } from '@/lib/tenant/current';

export type SetPasswordState = { error?: string };
export type LinkKind = 'reset' | 'invite';

export const MIN_PASSWORD_LENGTH = 10;

const EXPIRED: Record<LinkKind, string> = {
  reset: 'This link is invalid or has expired. Request a new one with "Forgot password?" on the sign-in page.',
  invite: mapAuthError('otp_expired'),
};

const WRONG_HOST = "Your password was changed — sign in at your company's address.";

/**
 * Sets the password from an emailed reset or invite link. The link works only on the host of the company it
 * was sent for; it signs nobody in (sign-in, and the 2FA code after it, come next on the sign-in page).
 */
export async function setPasswordFromLink(kind: LinkKind, formData: FormData): Promise<SetPasswordState> {
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  if (!token) redirect('/auth/error?code=missing_token');
  if (password.length < MIN_PASSWORD_LENGTH) return { error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
  if (password !== confirm) return { error: 'The passwords do not match.' };
  const { companyId } = await currentTenant();
  const auth = await tenantAuth();
  let done;
  try {
    done = kind === 'reset' ? await auth.resetPassword({ token, newPassword: password }) : await auth.acceptInvite({ token, password });
  } catch (e) {
    console.error('setPasswordFromLink failed', e instanceof Error ? e.name : 'error');
    return { error: mapAuthError(null) };
  }
  if (!done) return { error: EXPIRED[kind] };
  // The token is spent and the password changed even when this isn't the company's own host.
  if (done.companyId !== companyId) return { error: WRONG_HOST };
  redirect(`/login?notice=${kind === 'reset' ? 'password_reset' : 'invite_accepted'}`);
}

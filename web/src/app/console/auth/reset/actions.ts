'use server';

import { redirect } from 'next/navigation';
import { mapAuthError } from '@/lib/auth/errors';
import type { SetPasswordState } from '@/lib/auth/link-password';
import { requireConsoleHost } from '@/lib/console/session';
import { CONSOLE_COMPANY, consoleAuth } from '@/lib/self-auth/console';

const MIN_PASSWORD_LENGTH = 10;
const EXPIRED = 'This link is invalid or has expired. Ask for a new one from the console account page.';
const WRONG_HOST = "Your password was changed. Sign in at your company's address.";

/** Sets a console admin's password from the emailed reset link. It signs nobody in: the sign-in and the 2FA code come next. */
export async function resetConsolePassword(_prev: SetPasswordState, formData: FormData): Promise<SetPasswordState> {
  await requireConsoleHost();
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  if (!token) redirect('/console/login');
  if (password.length < MIN_PASSWORD_LENGTH) return { error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
  if (password !== confirm) return { error: 'The passwords do not match.' };
  let done;
  try {
    done = await (await consoleAuth()).resetPassword({ token, newPassword: password });
  } catch (e) {
    console.error('resetConsolePassword failed', e instanceof Error ? e.name : 'error');
    return { error: mapAuthError(null) };
  }
  if (!done) return { error: EXPIRED };
  // The token is spent either way; a company's link has no use on the console.
  if (done.companyId !== CONSOLE_COMPANY) return { error: WRONG_HOST };
  redirect('/console/login?notice=password_reset');
}

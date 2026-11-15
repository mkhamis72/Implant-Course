'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { GENERIC_AUTH_ERROR, mapAuthError } from '@/lib/auth/errors';
import { lastSeenCookieOptions } from '@/lib/supabase/middleware';
import { consoleAdminActive } from '@/lib/console/admin-active';
import { requireConsoleHost, requireConsoleUser } from '@/lib/console/session';
import { CONSOLE_LAST_SEEN_COOKIE } from '@/lib/console/middleware';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from '@/lib/self-auth/cookie';
import { CONSOLE_COMPANY, consoleAuth } from '@/lib/self-auth/console';
import type { Enrollment } from '@/app/(app)/account/security/actions';

const ALREADY_SET_UP = 'An authenticator is already set up.';

export type ConsoleAuthState = { error?: string; email?: string };

const REASON_CODES = { invalid_credentials: 'invalid_credentials', disabled: 'user_disabled', locked: 'sign_in_locked' } as const;

export async function signInConsole(_prev: ConsoleAuthState, formData: FormData): Promise<ConsoleAuthState> {
  await requireConsoleHost();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const auth = await consoleAuth();
  const result = await auth.signIn({ companyId: CONSOLE_COMPANY, email, password });
  if (!result.ok) return { error: mapAuthError(REASON_CODES[result.reason] ?? 'invalid_credentials'), email };
  // Not listed: same answer as a wrong password, so valid credentials are not revealed.
  if (!(await consoleAdminActive(result.session.userId))) {
    await auth.signOut(result.sessionToken);
    return { error: mapAuthError('invalid_credentials'), email };
  }
  const maxAge = Math.max(1, Math.floor((result.session.expiresAt.getTime() - Date.now()) / 1000));
  await setSessionCookie('console', result.sessionToken, maxAge);
  (await cookies()).set(CONSOLE_LAST_SEEN_COOKIE, String(Date.now()), lastSeenCookieOptions);
  // The admin guard decides: not listed → signed out; no factor → setup; factor → code.
  redirect('/console');
}

/** The session token for the calls that act on it; no cookie means sign in again. */
async function consoleToken(): Promise<string> {
  const token = await readSessionCookie('console');
  if (!token) redirect('/console/login');
  return token;
}

export async function verifyConsoleMfa(_prev: ConsoleAuthState, formData: FormData): Promise<ConsoleAuthState> {
  await requireConsoleHost();
  await requireConsoleUser();
  const code = String(formData.get('code') ?? '').replace(/\s/g, '');
  const token = await consoleToken();
  // The same session is raised to aal2.
  const session = await (await consoleAuth()).totp.verify(token, CONSOLE_COMPANY, code);
  if (!session) return { error: mapAuthError('mfa_verification_failed') };
  redirect('/console');
}

const CONSOLE_AUTHENTICATOR_NAME = 'Implant Course Console';

export async function startConsoleEnroll(): Promise<Enrollment | { error: string }> {
  await requireConsoleHost();
  await requireConsoleUser();
  const token = await consoleToken();
  try {
    // Replaces an unconfirmed secret; a confirmed authenticator must be removed first (never from an aal1 session).
    // Named apart from the companies in the authenticator app (they share one sign-in database).
    const { secret, otpauthUrl } = await (await consoleAuth()).totp.startEnroll(token, CONSOLE_COMPANY, { issuer: CONSOLE_AUTHENTICATOR_NAME });
    const qrCode = await QRCode.toDataURL(otpauthUrl, { width: 180, margin: 1 });
    return { factorId: 'totp', qrCode, secret };
  } catch (e) {
    if ((e as { code?: string }).code === 'totp_already_enrolled') return { error: ALREADY_SET_UP };
    return { error: GENERIC_AUTH_ERROR };
  }
}

export async function confirmConsoleEnroll(_factorId: string, code: string): Promise<{ ok: true } | { error: string }> {
  await requireConsoleHost();
  await requireConsoleUser();
  const token = await consoleToken();
  const session = await (await consoleAuth()).totp.confirmEnroll(token, CONSOLE_COMPANY, code.replace(/\s/g, ''));
  if (!session) return { error: mapAuthError('mfa_verification_failed') };
  return { ok: true };
}

export async function signOutConsole(): Promise<void> {
  const token = await readSessionCookie('console');
  if (token) await (await consoleAuth()).signOut(token);
  await clearSessionCookie('console');
  (await cookies()).delete(CONSOLE_LAST_SEEN_COOKIE);
  redirect('/console/login');
}

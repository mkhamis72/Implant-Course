'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { mapAuthError } from '@/lib/auth/errors';
import { lastSeenCookieOptions } from '@/lib/supabase/middleware';
import { createConsoleClient, createConsoleServiceClient } from '@/lib/console/supabase';
import { requireConsoleHost, requireConsoleUser } from '@/lib/console/session';
import { CONSOLE_LAST_SEEN_COOKIE } from '@/lib/console/middleware';
import type { Enrollment } from '@/app/(app)/account/security/actions';

const ALREADY_SET_UP = 'An authenticator is already set up.';

export type ConsoleAuthState = { error?: string; email?: string };

export async function signInConsole(_prev: ConsoleAuthState, formData: FormData): Promise<ConsoleAuthState> {
  await requireConsoleHost();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const supabase = await createConsoleClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: mapAuthError(error), email };
  // Not listed: same answer as a wrong password, so valid credentials are not revealed.
  const { data: { user } } = await supabase.auth.getUser();
  const { data: row } = user
    ? await createConsoleServiceClient().from('console_admins').select('active').eq('user_id', user.id).maybeSingle()
    : { data: null };
  if (!row?.active) {
    await supabase.auth.signOut({ scope: 'local' });
    return { error: mapAuthError('invalid_credentials'), email };
  }
  (await cookies()).set(CONSOLE_LAST_SEEN_COOKIE, String(Date.now()), lastSeenCookieOptions);
  // The admin guard decides: not listed → signed out; no factor → setup; factor → code.
  redirect('/console');
}

export async function verifyConsoleMfa(_prev: ConsoleAuthState, formData: FormData): Promise<ConsoleAuthState> {
  await requireConsoleHost();
  await requireConsoleUser();
  const code = String(formData.get('code') ?? '').replace(/\s/g, '');
  const supabase = await createConsoleClient();
  const { data, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return { error: mapAuthError(listError) };
  const factor = data.totp.find((f) => f.status === 'verified');
  if (!factor) redirect('/console/mfa/setup');
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) return { error: mapAuthError(error) };
  redirect('/console');
}

export async function startConsoleEnroll(): Promise<Enrollment | { error: string }> {
  await requireConsoleHost();
  await requireConsoleUser();
  const supabase = await createConsoleClient();
  const { data: existing, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return { error: mapAuthError(listError) };
  if (existing.all.some((f) => f.status === 'verified')) return { error: ALREADY_SET_UP };
  for (const f of existing.all) if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Console ${new Date().toISOString()}` });
  if (error) return { error: mapAuthError(error) };
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

export async function confirmConsoleEnroll(factorId: string, code: string): Promise<{ ok: true } | { error: string }> {
  await requireConsoleHost();
  await requireConsoleUser();
  const supabase = await createConsoleClient();
  // Enrolment is only for a first authenticator: never let an aal1 session add or replace one.
  const { data: existing, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return { error: mapAuthError(listError) };
  if (existing.all.some((f) => f.status === 'verified')) return { error: ALREADY_SET_UP };
  if (!existing.all.some((f) => f.id === factorId && f.factor_type === 'totp' && f.status === 'unverified')) return { error: 'Start the setup again.' };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, '') });
  if (error) return { error: mapAuthError(error) };
  return { ok: true };
}

export async function signOutConsole(): Promise<void> {
  const supabase = await createConsoleClient();
  await supabase.auth.signOut({ scope: 'local' });
  (await cookies()).delete(CONSOLE_LAST_SEEN_COOKIE);
  redirect('/console/login');
}

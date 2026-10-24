'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { mapAuthError } from '@/lib/auth/errors';
import { userMessage } from '@/lib/db-errors';

export type Enrollment = { factorId: string; qrCode: string; secret: string };

export async function startEnroll(): Promise<Enrollment | { error: string }> {
  const supabase = await createClient();
  const { data: existing } = await supabase.auth.mfa.listFactors();
  for (const factor of existing?.all ?? []) {
    if (factor.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `Authenticator ${new Date().toISOString()}`,
  });
  if (error) return { error: mapAuthError(error) };
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

export async function confirmEnroll(factorId: string, code: string): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, '') });
  if (error) return { error: mapAuthError(error) };
  // The verify put the aal2 session on this client (and its cookies), which mfa_setup_done checks:
  // it clears an admin's "must set up 2FA again" (a no-op for everyone else).
  const { error: doneError } = await supabase.rpc('mfa_setup_done');
  if (doneError) return { error: userMessage(doneError)! };
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function removeFactor(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId: String(formData.get('factor_id')) });
  if (error) throw new Error(mapAuthError(error));
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

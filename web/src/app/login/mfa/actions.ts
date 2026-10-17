'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { mapAuthError } from '@/lib/auth/errors';
import { afterMfaPath, RESET_COOKIE } from '@/lib/auth/password-reset';

export type MfaState = { error?: string };

export async function verifyMfa(_prev: MfaState, formData: FormData): Promise<MfaState> {
  const code = String(formData.get('code') ?? '').replace(/\s/g, '');
  const supabase = await createClient();
  const { data, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return { error: mapAuthError(listError) };
  const factor = data.totp.find((f) => f.status === 'verified');
  if (!factor) redirect('/');
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) return { error: mapAuthError(error) };
  redirect(afterMfaPath((await cookies()).get(RESET_COOKIE)?.value));
}

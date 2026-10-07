'use server';

import { mapAuthError } from '@/lib/auth/errors';
import { requireConsoleAdmin } from '@/lib/console/session';
import { createConsoleClient } from '@/lib/console/supabase';

export type ChangePasswordState = { ok?: string; error?: string };

/** The signed-in console admin's own password (same rules as the app's set-password page). */
export async function changeConsolePassword(_prev: ChangePasswordState, formData: FormData): Promise<ChangePasswordState> {
  await requireConsoleAdmin();
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  if (password.length < 10) return { error: 'Use at least 10 characters.' };
  if (password !== confirm) return { error: 'The passwords do not match.' };
  const supabase = await createConsoleClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: mapAuthError(error) };
  return { ok: 'Password changed.' };
}

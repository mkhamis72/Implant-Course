'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { mapAuthError } from '@/lib/auth/errors';
import { requireSignedIn } from '@/lib/auth/session';

export type SetPasswordState = { error?: string };

export async function setPassword(_prev: SetPasswordState, formData: FormData): Promise<SetPasswordState> {
  await requireSignedIn(); // staff and delegate logins (invite, temporary password, recovery)
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  if (password.length < 10) return { error: 'Use at least 10 characters.' };
  if (password !== confirm) return { error: 'The passwords do not match.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: mapAuthError(error) };
  redirect('/');
}

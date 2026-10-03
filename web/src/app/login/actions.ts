'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { mapAuthError } from '@/lib/auth/errors';
import { verifiedAal } from '@/lib/auth/redirects';
import { LAST_SEEN_COOKIE, lastSeenCookieOptions } from '@/lib/supabase/middleware';

export type LoginState = { error?: string; email?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: mapAuthError(error), email };
  // A new session starts active: a last-seen time left from an earlier session would end it at once.
  (await cookies()).set(LAST_SEEN_COOKIE, String(Date.now()), lastSeenCookieOptions);
  // A password sign-in is always aal1; factors come from the Auth server's response.
  const aal = verifiedAal(data.user.factors, 'aal1');
  redirect(aal.next === 'aal2' ? '/login/mfa' : '/');
}

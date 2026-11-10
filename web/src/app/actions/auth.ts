'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { clearSessionCookie, readSessionCookie } from '@/lib/self-auth/cookie';
import { tenantAuth } from '@/lib/self-auth/tenant';
import { LAST_SEEN_COOKIE } from '@/lib/supabase/middleware';

export async function signOut() {
  // Only this browser's session ends; the user's sessions on other devices stay.
  const token = await readSessionCookie('tenant');
  // A failed revoke is an error, not a quiet sign-out that leaves the session alive.
  if (token) await (await tenantAuth()).signOut(token);
  await clearSessionCookie('tenant');
  (await cookies()).delete(LAST_SEEN_COOKIE);
  redirect('/login');
}

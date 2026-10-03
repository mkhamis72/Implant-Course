'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { LAST_SEEN_COOKIE } from '@/lib/supabase/middleware';

export async function signOut() {
  const supabase = await createClient();
  // 'local': signing out here must not end the user's sessions on other devices.
  await supabase.auth.signOut({ scope: 'local' });
  (await cookies()).delete(LAST_SEEN_COOKIE);
  redirect('/login');
}

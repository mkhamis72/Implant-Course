'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function signOut() {
  const supabase = await createClient();
  // 'local': signing out here must not end the user's sessions on other devices.
  await supabase.auth.signOut({ scope: 'local' });
  redirect('/login');
}

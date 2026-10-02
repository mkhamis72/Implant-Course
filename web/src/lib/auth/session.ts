import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Role } from '@/components/nav-items';

export type Profile = {
  user_id: string;
  full_name: string;
  email: string;
  role: Role;
  active: boolean;
};

export type Settings = { expiry_alert_days: number; session_timeout_minutes: number };

export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, full_name, email, role, active')
    .eq('user_id', user.id)
    .maybeSingle();
  // A failed lookup is an error page, not "signed out": redirecting to /login would loop.
  if (error) throw new Error('Could not load your account');
  // Signed in but no profile row: treat as deactivated (an admin has to set the account up).
  return (data as Profile | null) ?? { user_id: user.id, full_name: '', email: user.email ?? '', role: 'organizer', active: false };
});

export async function requireAdmin(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile || !profile.active || profile.role !== 'admin') redirect('/');
  return profile;
}

export const getSettings = cache(async (): Promise<Settings> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('settings')
    .select('expiry_alert_days, session_timeout_minutes')
    .single();
  if (error || !data) throw new Error('Could not load settings');
  return data as Settings;
});

/** For server actions: actions can be called directly, so don't rely on the layout's check. */
export async function requireActiveUser(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  if (!profile.active) redirect('/deactivated');
  return profile;
}

import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import {
  canEdit, canView, permissionMessage, toPermissions, type Area, type Level, type Permissions, type Role,
} from './permissions';

export type Profile = {
  user_id: string;
  full_name: string;
  email: string;
  role: Role;
  active: boolean;
  delegate_id: string | null;
  /** Set by an admin's 2FA reset: nothing but Account → Security until a factor is verified again. */
  mfa_setup_required: boolean;
  permissions: Permissions;
};

export const MFA_SETUP_PATH = '/account/security';
export const MFA_SETUP_MESSAGE = 'Set up two-factor authentication first.';

export type Settings = { expiry_alert_days: number; session_timeout_minutes: number };

export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, full_name, email, role, active, delegate_id, mfa_setup_required, permissions:user_permissions(area, level)')
    .eq('user_id', user.id)
    .maybeSingle();
  // A failed lookup is an error page, not "signed out": redirecting to /login would loop.
  if (error) throw new Error('Could not load your account');
  // Signed in but no profile row: treat as deactivated (an admin has to set the account up).
  if (!data) {
    return { user_id: user.id, full_name: '', email: user.email ?? '', role: 'organizer', active: false, delegate_id: null, mfa_setup_required: false, permissions: {} };
  }
  const row = data as Omit<Profile, 'permissions'> & { permissions: { area: string; level: string }[] | null };
  return { ...row, permissions: toPermissions(row.permissions) };
});

export async function requireAdmin(): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile || !profile.active || profile.role !== 'admin') redirect('/');
  if (profile.mfa_setup_required) redirect(MFA_SETUP_PATH);
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

/**
 * Any active account, staff or delegate. `allowMfaSetup`: only Account → Security and Set password, the pages a user who must
 * set up 2FA again may use.
 */
export async function requireSignedIn(options: { allowMfaSetup?: boolean } = {}): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  if (!profile.active) redirect('/deactivated');
  if (profile.mfa_setup_required && !options.allowMfaSetup) redirect(MFA_SETUP_PATH);
  return profile;
}

/** Staff only. For server actions too: actions can be called directly, so don't rely on the layout's check. */
export async function requireActiveUser(): Promise<Profile> {
  const profile = await requireSignedIn();
  if (profile.role === 'delegate') redirect('/my');
  return profile;
}

/** Pages: without the permission the user goes back to the dashboard. */
export async function requirePermission(area: Area, level: Level = 'view'): Promise<Profile> {
  const profile = await requireActiveUser();
  if (!(level === 'edit' ? canEdit(profile, area) : canView(profile, area))) redirect('/');
  return profile;
}

/** Actions: an error message to show in the form, or null when allowed. */
export async function checkPermission(area: Area, level: Level = 'edit'): Promise<string | null> {
  if ((await requireSignedIn({ allowMfaSetup: true })).mfa_setup_required) return MFA_SETUP_MESSAGE;
  const profile = await requireActiveUser();
  return (level === 'edit' ? canEdit(profile, area) : canView(profile, area)) ? null : permissionMessage(level, area);
}

/** Delegate pages. */
export async function requireDelegate(): Promise<Profile> {
  const profile = await requireSignedIn();
  if (profile.role !== 'delegate') redirect('/');
  return profile;
}

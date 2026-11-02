import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { currentTenant } from '@/lib/tenant/current';
import { ensureSessionCompany } from './company-session';
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

type Account = { profile: Profile | null; companyRefused: boolean };
type MemberRow = Pick<Profile, 'role' | 'active' | 'delegate_id' | 'mfa_setup_required'> & {
  profile: { full_name: string; email: string } | null;
};

/** The signed-in user as a member of this host's company. Ends the session when it doesn't belong here. */
const loadAccount = cache(async (): Promise<Account> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { profile: null, companyRefused: false };
  const { companyId } = await currentTenant();
  if ((await ensureSessionCompany(supabase, companyId)) === 'refused') return { profile: null, companyRefused: true };
  const [member, perms] = await Promise.all([
    supabase
      .from('company_members')
      .select('role, active, delegate_id, mfa_setup_required, profile:profiles(full_name, email)')
      .eq('company_id', companyId)
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase.from('user_permissions').select('area, level').eq('company_id', companyId).eq('user_id', user.id),
  ]);
  // A failed lookup is an error page, not "signed out": redirecting to /login would loop.
  if (member.error || perms.error) throw new Error('Could not load your account');
  const row = member.data as MemberRow | null;
  // Signed in but no member row: treat as deactivated (an admin has to set the account up).
  if (!row) {
    return {
      profile: { user_id: user.id, full_name: '', email: user.email ?? '', role: 'organizer', active: false, delegate_id: null, mfa_setup_required: false, permissions: {} },
      companyRefused: false,
    };
  }
  // Deactivated in this company since signing in: the session ends on its next request.
  if (!row.active) {
    await supabase.auth.signOut({ scope: 'local' });
    return { profile: null, companyRefused: true };
  }
  const { profile, ...membership } = row;
  return {
    profile: {
      user_id: user.id,
      full_name: profile?.full_name ?? '',
      email: profile?.email ?? user.email ?? '',
      ...membership,
      permissions: toPermissions(perms.data as { area: string; level: string }[] | null),
    },
    companyRefused: false,
  };
});

/** Null means "not signed in here": no session, or one this company refused (then signed out). */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => (await loadAccount()).profile);

/** Where a request without a profile signs in: with the reason when this company refused the session. */
export async function signInPath(): Promise<string> {
  return (await loadAccount()).companyRefused ? '/login?error=company' : '/login';
}

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
  if (!profile) redirect(await signInPath());
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

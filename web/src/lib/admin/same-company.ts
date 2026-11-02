import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { currentTenant } from '@/lib/tenant/current';

/**
 * Whether the user is a member of this host's company, read through the admin's own RLS client.
 * Check it before any service-role Auth call. False on any failure.
 */
export async function memberOfMyCompany(userId: string): Promise<boolean> {
  const { companyId } = await currentTenant();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('company_members')
    .select('user_id')
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) console.error('Company membership check failed:', error.message);
  return !!data;
}

/**
 * Whether the user has memberships of other companies (active ones only with `activeOnly`). The admin's RLS
 * client can't be relied on to see those rows, so this reads with the service role. True on any failure.
 */
async function memberElsewhere(userId: string, activeOnly: boolean): Promise<boolean> {
  try {
    const { companyId } = await currentTenant();
    const admin = await createAdminClient();
    const query = admin
      .from('company_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .neq('company_id', companyId);
    const { count, error } = await (activeOnly ? query.eq('active', true) : query);
    if (error) {
      console.error('Other-company membership check failed:', error.message);
      return true;
    }
    return (count ?? 0) > 0;
  } catch (error) {
    console.error('Other-company membership check failed:', (error as Error).message);
    return true;
  }
}

/** A sign-in shared with another company: its password, email and 2FA aren't this company's to change. */
export function sharedWithAnotherCompany(userId: string): Promise<boolean> {
  return memberElsewhere(userId, false);
}

/** Another company still has the user active, so their sign-in mustn't be banned. */
export function activeInAnotherCompany(userId: string): Promise<boolean> {
  return memberElsewhere(userId, true);
}

/** Whether the user's profile is still there (another company keeps it); null when it can't be read. */
export async function profileRemains(userId: string): Promise<boolean | null> {
  try {
    const admin = await createAdminClient();
    const { data, error } = await admin.from('profiles').select('user_id').eq('user_id', userId).maybeSingle();
    if (error) {
      console.error('Profile check failed:', error.message);
      return null;
    }
    return !!data;
  } catch (error) {
    console.error('Profile check failed:', (error as Error).message);
    return null;
  }
}

export const USER_NOT_FOUND = 'User not found.';
export const SHARED_USER = 'This user also belongs to another company. Ask support to change their sign-in details.';

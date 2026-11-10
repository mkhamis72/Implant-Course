import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { currentTenant } from '@/lib/tenant/current';

/**
 * Whether the user is a member of this host's company, read through the admin's own RLS client.
 * Checked before any Self-Auth call (which checks the company again). False on any failure.
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

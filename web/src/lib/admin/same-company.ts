import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * Whether the user is a member of the signed-in admin's company, read through the admin's own RLS client.
 * Under RLS an admin sees every profile in their database, which today is their company; once companies
 * share a database this moves to company_members. Check it before any service-role Auth call.
 */
export async function memberOfMyCompany(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.from('profiles').select('user_id').eq('user_id', userId).maybeSingle();
  return !!data;
}

export const USER_NOT_FOUND = 'User not found.';

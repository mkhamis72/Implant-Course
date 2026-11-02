import 'server-only';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { currentTenant } from '@/lib/tenant/current';

export type StaffOption = { id: string; label: string };
type StaffRow = { user_id: string; profile: { full_name: string | null; email: string | null } | null };

/**
 * The staff pickers' choices (checklist assignee, lead organizer, fitted by organizer): this company's active
 * admins and organizers, by name. A delegate login is an active member too, so the role filter matters (0037).
 */
export async function staffOptions(
  supabase: SupabaseClient,
): Promise<{ data: StaffOption[] | null; error: PostgrestError | null }> {
  const { companyId } = await currentTenant();
  const { data, error } = await supabase
    .from('company_members')
    .select('user_id, profile:profiles(full_name, email)')
    .eq('company_id', companyId)
    .eq('active', true)
    .in('role', ['admin', 'organizer']);
  if (error) return { data: null, error };
  const options = ((data ?? []) as unknown as StaffRow[])
    .map((m) => ({ id: m.user_id, label: m.profile?.full_name || m.profile?.email || '' }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return { data: options, error: null };
}

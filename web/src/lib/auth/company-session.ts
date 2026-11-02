import type { SupabaseClient } from '@supabase/supabase-js';

export type SessionCompanyResult = 'ok' | 'refused';

export const COMPANY_REFUSED_MESSAGE = 'You do not have access to this company.';

/**
 * A sign-in session belongs to one company for life: the one whose host it signed in on. The database
 * refuses a non-member, an inactive member and a session already bound elsewhere; any refusal ends the session.
 */
export async function bindSessionToCompany(supabase: SupabaseClient, companyId: string): Promise<SessionCompanyResult> {
  const { error } = await supabase.rpc('bind_my_session', { p_company: companyId });
  if (!error) return 'ok';
  await supabase.auth.signOut({ scope: 'local' });
  return 'refused';
}

/**
 * Every request: the session must belong to this host's company. An unbound session (signed in by the
 * previous app version, or restored from a backup) is bound now if the user is a member here.
 */
export async function ensureSessionCompany(supabase: SupabaseClient, companyId: string): Promise<SessionCompanyResult> {
  const { data, error } = await supabase.rpc('my_session_company');
  // A failed lookup is an error page, not a sign-out: an outage must not end everyone's session.
  if (error) throw new Error('Could not check your session');
  if (data == null) return bindSessionToCompany(supabase, companyId);
  if (data === companyId) return 'ok';
  await supabase.auth.signOut({ scope: 'local' });
  return 'refused';
}

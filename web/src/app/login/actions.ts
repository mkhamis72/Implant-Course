'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { GENERIC_AUTH_ERROR, mapAuthError } from '@/lib/auth/errors';
import { bindSessionToCompany, COMPANY_REFUSED_MESSAGE } from '@/lib/auth/company-session';
import { verifiedAal } from '@/lib/auth/redirects';
import { LAST_SEEN_COOKIE, lastSeenCookieOptions } from '@/lib/supabase/middleware';
import { currentTenant } from '@/lib/tenant/current';

export type LoginState = { error?: string; email?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: mapAuthError(error), email };
  // From now on the session belongs to this host's company; a non-member is signed out again at once.
  const { companyId } = await currentTenant();
  let bound;
  try {
    bound = await bindSessionToCompany(supabase, companyId);
  } catch (e) {
    // An outage is not a refusal: say so generically (the next request binds the session lazily).
    console.error('login: could not bind the session', e);
    return { error: GENERIC_AUTH_ERROR, email };
  }
  if (bound === 'refused') return { error: COMPANY_REFUSED_MESSAGE, email };
  // A new session starts active: a last-seen time left from an earlier session would end it at once.
  (await cookies()).set(LAST_SEEN_COOKIE, String(Date.now()), lastSeenCookieOptions);
  // A password sign-in is always aal1; factors come from the Auth server's response.
  const aal = verifiedAal(data.user.factors, 'aal1');
  if (aal.next === 'aal2') redirect('/login/mfa');
  // Delegate logins have their own home; going via the staff dashboard would only redirect again.
  const { data: member } = await supabase
    .from('company_members')
    .select('role')
    .eq('company_id', companyId)
    .eq('user_id', data.user.id)
    .maybeSingle();
  redirect(member?.role === 'delegate' ? '/my' : '/');
}

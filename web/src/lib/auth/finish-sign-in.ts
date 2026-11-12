import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Session } from '@mkhamis72/self-auth';
import { createClientForSession } from '@/lib/supabase/server';
import { GENERIC_AUTH_ERROR } from '@/lib/auth/errors';
import { bindSessionToCompany, COMPANY_REFUSED_MESSAGE } from '@/lib/auth/company-session';
import { LAST_SEEN_COOKIE, lastSeenCookieOptions } from '@/lib/supabase/middleware';
import { setSessionCookie } from '@/lib/self-auth/cookie';

export type FinishSignInFailure = { error: string; code: 'company' | 'unavailable' };

/**
 * Shared by the password and Google sign-ins once Self-Auth has issued a session: sets the cookie, binds the
 * session to the host's company, starts the idle clock and redirects. Returns only on failure (never on success).
 */
export async function finishSignIn(input: {
  companyId: string;
  sessionToken: string;
  session: Session;
  needsTotp: boolean;
}): Promise<FinishSignInFailure> {
  const { companyId, sessionToken, session, needsTotp } = input;
  const maxAge = Math.max(1, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));
  await setSessionCookie('tenant', sessionToken, maxAge);
  // From now on the session belongs to this host's company; a non-member is signed out again at once.
  const supabase = await createClientForSession(session);
  let bound;
  try {
    bound = await bindSessionToCompany(supabase, companyId);
  } catch (e) {
    // An outage is not a refusal: say so generically (the next request binds the session lazily).
    console.error('sign-in: could not bind the session', e);
    return { error: GENERIC_AUTH_ERROR, code: 'unavailable' };
  }
  if (bound === 'refused') return { error: COMPANY_REFUSED_MESSAGE, code: 'company' };
  // A new session starts active: a last-seen time left from an earlier session would end it at once.
  (await cookies()).set(LAST_SEEN_COOKIE, String(Date.now()), lastSeenCookieOptions);
  // Password (or Google) only gives aal1; with an authenticator the code page comes next.
  if (needsTotp) redirect('/login/mfa');
  // Delegate logins have their own home; going via the staff dashboard would only redirect again.
  const { data: member } = await supabase
    .from('company_members')
    .select('role')
    .eq('company_id', companyId)
    .eq('user_id', session.userId)
    .maybeSingle();
  redirect(member?.role === 'delegate' ? '/my' : '/');
}

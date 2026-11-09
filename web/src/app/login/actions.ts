'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClientForSession } from '@/lib/supabase/server';
import { GENERIC_AUTH_ERROR, mapAuthError } from '@/lib/auth/errors';
import { bindSessionToCompany, COMPANY_REFUSED_MESSAGE } from '@/lib/auth/company-session';
import { LAST_SEEN_COOKIE, lastSeenCookieOptions } from '@/lib/supabase/middleware';
import { setSessionCookie } from '@/lib/self-auth/cookie';
import { tenantAuth } from '@/lib/self-auth/tenant';
import { currentTenant } from '@/lib/tenant/current';

export type LoginState = { error?: string; email?: string };

const REASON_CODES = { invalid_credentials: 'invalid_credentials', disabled: 'user_disabled', locked: 'sign_in_locked' } as const;

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const { companyId } = await currentTenant();
  // Accounts are per company: this host's company is the only one the email and password are tried against.
  const result = await (await tenantAuth()).signIn({ companyId, email, password });
  if (!result.ok) return { error: mapAuthError(REASON_CODES[result.reason] ?? 'invalid_credentials'), email };
  const maxAge = Math.max(1, Math.floor((result.session.expiresAt.getTime() - Date.now()) / 1000));
  await setSessionCookie('tenant', result.sessionToken, maxAge);
  // From now on the session belongs to this host's company; a non-member is signed out again at once.
  const supabase = await createClientForSession(result.session);
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
  // Password only gives aal1; with an authenticator the code page comes next.
  if (result.needsTotp) redirect('/login/mfa');
  // Delegate logins have their own home; going via the staff dashboard would only redirect again.
  const { data: member } = await supabase
    .from('company_members')
    .select('role')
    .eq('company_id', companyId)
    .eq('user_id', result.session.userId)
    .maybeSingle();
  redirect(member?.role === 'delegate' ? '/my' : '/');
}

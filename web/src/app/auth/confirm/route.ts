import type { EmailOtpType } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { RESET_COOKIE, resetCookieOptions } from '@/lib/auth/password-reset';
import { bindSessionToCompany } from '@/lib/auth/company-session';
import { currentTenant } from '@/lib/tenant/current';

const ALLOWED_TYPES: EmailOtpType[] = ['invite', 'recovery', 'email', 'signup'];

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get('token_hash');
  const type = params.get('type') as EmailOtpType | null;
  if (!tokenHash || !type || !ALLOWED_TYPES.includes(type)) {
    redirect('/auth/error?code=missing_token');
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    // Any verification failure (bad, used or expired token) reads as "invalid or expired".
    redirect(`/auth/error?code=${error.code === 'over_request_rate_limit' ? error.code : 'otp_expired'}`);
  }
  // The link's session belongs to this host's company, and only if the user is a member here.
  const { companyId } = await currentTenant();
  let bound;
  try {
    bound = await bindSessionToCompany(supabase, companyId);
  } catch (e) {
    // An outage is not a refusal: the error page shows the generic message.
    console.error('auth/confirm: could not bind the session', e);
    redirect('/auth/error?code=unexpected');
  }
  if (bound === 'refused') redirect('/auth/error?code=company');
  // With 2FA, middleware sends a reset to /login/mfa first; this mark brings it back to the new password.
  if (type === 'recovery') (await cookies()).set(RESET_COOKIE, '1', resetCookieOptions);
  redirect(type === 'invite' || type === 'recovery' ? '/account/set-password' : '/');
}

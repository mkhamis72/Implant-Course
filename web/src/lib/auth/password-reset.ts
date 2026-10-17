/**
 * Self-service password reset ("Forgot password?" on the login page).
 * The reply never says whether an address has an account. A reset link signs the user in at aal1, so a user
 * with 2FA still enters their code (middleware); this cookie lets the 2FA step continue to the new-password page.
 */
export const RESET_COOKIE = 'icm_reset_pending';

export const resetCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 15 * 60,
} as const;

export const FORGOT_SENT =
  "If an account exists for that address, we've emailed a link to set a new password. It works for 24 hours.";
export const FORGOT_TOO_MANY = 'Too many requests. Wait a minute and try again.';

type AuthLikeError = { code?: string; message: string; status?: number };

export function forgotReply(error: AuthLikeError | null | undefined): string {
  if (!error) return FORGOT_SENT;
  if (error.status === 429 || error.code === 'over_email_send_rate_limit' || error.code === 'over_request_rate_limit') {
    return FORGOT_TOO_MANY;
  }
  return FORGOT_SENT;
}

export function afterMfaPath(resetPending: string | undefined): string {
  return resetPending ? '/account/set-password' : '/';
}

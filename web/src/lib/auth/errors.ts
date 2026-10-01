type AuthLikeError = { code?: string; message: string; status?: number };

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'Incorrect email or password.',
  email_not_confirmed: 'Please verify your email first — check your inbox for the verification link.',
  user_banned: 'This account has been deactivated. Contact an admin.',
  otp_expired: 'This link is invalid or has expired. Ask an admin to send a new invite.',
  mfa_verification_failed: 'That code is not correct. Check your authenticator app and try again.',
  mfa_challenge_expired: 'The code expired. Enter the current code from your app.',
  same_password: 'Choose a password different from your current one.',
  weak_password: 'That password is too weak. Use at least 10 characters.',
  email_exists: 'A user with this email already exists.',
  missing_token: 'This link is incomplete. Open the link from your email again.',
  over_request_rate_limit: 'Too many attempts. Wait a minute and try again.',
};

export const GENERIC_AUTH_ERROR = 'Something went wrong. Please try again.';

export function mapAuthError(error: AuthLikeError | string | null | undefined): string {
  if (!error) return GENERIC_AUTH_ERROR;
  const code = typeof error === 'string' ? error : error.code;
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (typeof error !== 'string' && error.status === 422 && /already been registered/i.test(error.message)) {
    return MESSAGES.email_exists;
  }
  return GENERIC_AUTH_ERROR;
}

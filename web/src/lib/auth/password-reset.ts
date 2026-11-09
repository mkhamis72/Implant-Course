/**
 * Self-service password reset ("Forgot password?" on the login page).
 * The reply never says whether an address has an account. The reset link sets a new password only; it does
 * not sign anyone in, so a user with 2FA still enters their code at the next sign-in.
 */
export const FORGOT_SENT =
  "If an account exists for that address, we've emailed a link to set a new password. It works for 24 hours.";
export const FORGOT_TOO_MANY = 'Too many requests. Wait a minute and try again.';

export type PathKind = 'public' | 'mfa' | 'protected';
export type Aal = { current: string | null; next: string | null } | null;

// /brand/logo: the company logo, shown on the login page before anyone signs in.
const PUBLIC_PATHS = new Set(['/login', '/login/forgot', '/auth/confirm', '/auth/error', '/brand/logo']);

export function classifyPath(path: string): PathKind {
  if (PUBLIC_PATHS.has(path)) return 'public';
  if (path === '/login/mfa') return 'mfa';
  return 'protected';
}

function needsMfa(aal: Aal): boolean {
  return aal?.next === 'aal2' && aal.current !== 'aal2';
}

// Open while an admin's 2FA reset requires set-up again (sign-in pages are public; /deactivated avoids a loop).
const MFA_SETUP_PATHS = new Set(['/account/security', '/deactivated']);

/**
 * Returns the path to redirect to, or null to let the request through. `mfaSetupRequired`: the profile's
 * "must set up 2FA again" flag, when the caller has it (the session guards enforce it regardless).
 */
export function decideRedirect(input: { path: string; hasUser: boolean; aal: Aal; mfaSetupRequired?: boolean }): string | null {
  const { path, hasUser, aal, mfaSetupRequired } = input;
  const kind = classifyPath(path);
  if (kind === 'public') {
    if (path === '/login' && hasUser) return needsMfa(aal) ? '/login/mfa' : '/';
    return null;
  }
  if (!hasUser) return '/login';
  if (kind === 'mfa') return needsMfa(aal) ? null : '/';
  if (needsMfa(aal)) return '/login/mfa';
  return mfaSetupRequired && !MFA_SETUP_PATHS.has(path) ? '/account/security' : null;
}

/**
 * Assurance level from server-verified data only: factors from the Auth server's user
 * record and `aal` from a verified JWT. Never derive this from the session cookie's
 * stored user, which the browser can edit. A missing claim counts as aal1 (fail closed).
 */
export function verifiedAal(
  factors: ReadonlyArray<{ status: string }> | undefined,
  tokenAal: unknown,
): { current: string; next: string } {
  const current = tokenAal === 'aal2' ? 'aal2' : 'aal1';
  const next = factors?.some((f) => f.status === 'verified') ? 'aal2' : current;
  return { current, next };
}

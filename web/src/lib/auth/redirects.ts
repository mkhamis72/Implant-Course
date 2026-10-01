export type PathKind = 'public' | 'mfa' | 'protected';
export type Aal = { current: string | null; next: string | null } | null;

const PUBLIC_PATHS = new Set(['/login', '/auth/confirm', '/auth/error']);

export function classifyPath(path: string): PathKind {
  if (PUBLIC_PATHS.has(path)) return 'public';
  if (path === '/login/mfa') return 'mfa';
  return 'protected';
}

function needsMfa(aal: Aal): boolean {
  return aal?.next === 'aal2' && aal.current !== 'aal2';
}

/** Returns the path to redirect to, or null to let the request through. */
export function decideRedirect(input: { path: string; hasUser: boolean; aal: Aal }): string | null {
  const { path, hasUser, aal } = input;
  const kind = classifyPath(path);
  if (kind === 'public') {
    if (path === '/login' && hasUser) return needsMfa(aal) ? '/login/mfa' : '/';
    return null;
  }
  if (!hasUser) return '/login';
  if (kind === 'mfa') return needsMfa(aal) ? null : '/';
  return needsMfa(aal) ? '/login/mfa' : null;
}

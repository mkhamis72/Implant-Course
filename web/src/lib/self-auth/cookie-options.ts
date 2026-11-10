// No 'server-only' and no next/headers: the middleware reads and writes the cookie on request/response objects.
export type SessionKind = 'tenant' | 'console';
export const SESSION_COOKIE_NAME: Record<SessionKind, string> = { tenant: 'icm_session', console: 'icm_console_session' };

// Host-only on purpose: no Domain, so one company's host never sees another's cookie.
const secure = () => !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(process.env.SITE_URL ?? '');
export const sessionCookieOptions = (maxAge: number) =>
  ({ httpOnly: true, secure: secure(), sameSite: 'lax' as const, path: '/', maxAge });

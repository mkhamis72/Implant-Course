import 'server-only';
import { cookies } from 'next/headers';

export type SessionKind = 'tenant' | 'console';
const NAME: Record<SessionKind, string> = { tenant: 'icm_session', console: 'icm_console_session' };

// Host-only on purpose: no Domain, so one company's host never sees another's cookie.
const secure = () => !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(process.env.SITE_URL ?? '');
const options = (maxAge: number) => ({ httpOnly: true, secure: secure(), sameSite: 'lax' as const, path: '/', maxAge });

// cookies() is async in Next 15, so these are too.
export async function readSessionCookie(kind: SessionKind): Promise<string | null> {
  return (await cookies()).get(NAME[kind])?.value || null;
}

export async function setSessionCookie(kind: SessionKind, token: string, maxAgeSeconds: number): Promise<void> {
  (await cookies()).set(NAME[kind], token, options(maxAgeSeconds));
}

export async function clearSessionCookie(kind: SessionKind): Promise<void> {
  (await cookies()).set(NAME[kind], '', options(0));
}

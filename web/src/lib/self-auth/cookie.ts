import 'server-only';
import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME as NAME, sessionCookieOptions as options, type SessionKind } from './cookie-options';

export type { SessionKind };

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

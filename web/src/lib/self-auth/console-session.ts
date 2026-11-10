import 'server-only';
import { cache } from 'react';
import type { Session } from '@mkhamis72/self-auth';
import { readSessionCookie } from './cookie';
import { CONSOLE_COMPANY, consoleAuth } from './console';

/**
 * This request's console Self-Auth session (company 'console'), or null: no cookie, expired, revoked, disabled,
 * or a cookie that belongs to a company. Server Components cannot clear the cookie; the middleware does.
 */
export const currentConsoleSession = cache(async (): Promise<Session | null> => {
  const token = await readSessionCookie('console');
  if (!token) return null;
  return (await consoleAuth()).getSession(token, CONSOLE_COMPANY);
});

/** A 5-minute database token for this request's console session, memoized per request only (never across requests). */
export const consoleDbToken = cache(async (): Promise<string | null> => {
  const session = await currentConsoleSession();
  return session ? (await consoleAuth()).issueDbToken(session) : null;
});

import { NextResponse, type NextRequest } from 'next/server';
import { TENANT_HEADER } from '@/lib/tenant/types';
import { contentSecurityPolicy } from '@/lib/security-headers';
import { isIdleExpired } from '@/lib/idle';
import { lastSeenCookieOptions } from '@/lib/supabase/middleware';
import { blockedResponse } from '@/lib/tenant/responses';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '@/lib/self-auth/cookie-options';
import { CONSOLE_COMPANY, consoleAuth } from '@/lib/self-auth/console';
import { controlConfig } from './env';

export const CONSOLE_LAST_SEEN_COOKIE = 'icm_console_last_seen';
export const CONSOLE_IDLE_MINUTES = 15;
export const CONSOLE_PUBLIC_PATHS = ['/console/login', '/console/auth/reset'];

/** Console requests (Node runtime): resolve the Self-Auth console session, enforce the 15-minute idle limit, control-only CSP. */
export async function updateConsoleSession(request: NextRequest): Promise<Response> {
  let control: ReturnType<typeof controlConfig>;
  try {
    control = controlConfig();
  } catch {
    return blockedResponse('unavailable');
  }
  const csp = contentSecurityPolicy(control.url, process.env.NODE_ENV !== 'production');
  // Never a company request: drop any browser-sent company header.
  const headers = new Headers(request.headers);
  headers.delete(TENANT_HEADER);
  const response = NextResponse.next({ request: { headers } });

  const token = request.cookies.get(SESSION_COOKIE_NAME.console)?.value || null;
  const auth = token ? await consoleAuth() : null;
  const session = token && auth ? await auth.getSession(token, CONSOLE_COMPANY) : null;
  // No session behind the cookie (expired, revoked, disabled, or a company's): drop it.
  const path = request.nextUrl.pathname;
  if (token && !session) {
    // On a page that needs a session, answer here with the redirect: a page that redirects after this would make
    // Next re-send the cookie without its Max-Age, leaving an empty cookie behind.
    if (!CONSOLE_PUBLIC_PATHS.includes(path) && path !== '/console/signout') {
      const url = request.nextUrl.clone();
      url.pathname = '/console/login';
      url.search = '';
      const redirect = NextResponse.redirect(url);
      redirect.cookies.set(SESSION_COOKIE_NAME.console, '', sessionCookieOptions(0));
      redirect.headers.set('Content-Security-Policy', csp);
      return redirect;
    }
    response.cookies.set(SESSION_COOKIE_NAME.console, '', sessionCookieOptions(0));
  }

  if (session && token && auth && !CONSOLE_PUBLIC_PATHS.includes(path)) {
    const raw = request.cookies.get(CONSOLE_LAST_SEEN_COOKIE)?.value;
    // The last-seen cookie is a session cookie but the session cookie persists: no (or a garbled) cookie means a new browser session, so sign in again.
    const lastSeen = raw ? Number(raw) : NaN;
    if (!Number.isFinite(lastSeen) || isIdleExpired(lastSeen, Date.now(), CONSOLE_IDLE_MINUTES)) {
      await auth.signOut(token);
      const url = request.nextUrl.clone();
      url.pathname = '/console/login';
      url.search = '?reason=idle';
      const redirect = NextResponse.redirect(url);
      redirect.cookies.set(SESSION_COOKIE_NAME.console, '', sessionCookieOptions(0));
      redirect.cookies.delete(CONSOLE_LAST_SEEN_COOKIE);
      redirect.headers.set('Content-Security-Policy', csp);
      return redirect;
    }
    response.cookies.set(CONSOLE_LAST_SEEN_COOKIE, String(Date.now()), lastSeenCookieOptions);
  }
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

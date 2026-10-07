import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { TENANT_HEADER } from '@/lib/tenant/types';
import { contentSecurityPolicy } from '@/lib/security-headers';
import { isIdleExpired } from '@/lib/idle';
import { lastSeenCookieOptions } from '@/lib/supabase/middleware';
import { blockedResponse } from '@/lib/tenant/responses';
import { controlConfig } from './env';

export const CONSOLE_LAST_SEEN_COOKIE = 'icm_console_last_seen';
export const CONSOLE_IDLE_MINUTES = 15;
export const CONSOLE_PUBLIC_PATHS = ['/console/login'];

/** Console requests: refresh the control-project session, enforce the 15-minute idle limit, control-only CSP. */
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
  const next = () => NextResponse.next({ request: { headers } });
  let response = next();
  const supabase = createServerClient(control.url, control.anonKey, {
    cookieOptions: { secure: process.env.NODE_ENV === 'production' },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = next();
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  if (user && !CONSOLE_PUBLIC_PATHS.includes(path)) {
    const raw = request.cookies.get(CONSOLE_LAST_SEEN_COOKIE)?.value;
    // The last-seen cookie is a session cookie but the auth cookies persist: no (or a garbled) cookie means a new browser session, so sign in again.
    const lastSeen = raw ? Number(raw) : NaN;
    if (!Number.isFinite(lastSeen) || isIdleExpired(lastSeen, Date.now(), CONSOLE_IDLE_MINUTES)) {
      await supabase.auth.signOut({ scope: 'local' });
      const url = request.nextUrl.clone();
      url.pathname = '/console/login';
      url.search = '?reason=idle';
      const redirect = NextResponse.redirect(url);
      response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
      redirect.cookies.delete(CONSOLE_LAST_SEEN_COOKIE);
      redirect.headers.set('Content-Security-Policy', csp);
      return redirect;
    }
    response.cookies.set(CONSOLE_LAST_SEEN_COOKIE, String(Date.now()), lastSeenCookieOptions);
  }
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

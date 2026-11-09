import { createClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { routeHost } from '@/lib/tenant/route';
import { blockedResponse, forwardHeaders } from '@/lib/tenant/responses';
import { contentSecurityPolicy } from '@/lib/security-headers';
import { classifyPath, decideRedirect, type Aal } from '@/lib/auth/redirects';
import { isIdleExpired } from '@/lib/idle';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '@/lib/self-auth/cookie-options';
import { tenantAuth } from '@/lib/self-auth/tenant';

/** httpOnly timestamp of the user's last request, so the server enforces the idle timeout too. */
export const LAST_SEEN_COOKIE = 'icm_last_seen';
const DEFAULT_TIMEOUT_MINUTES = 30;

export const lastSeenCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
} as const;

function redirectTo(request: NextRequest, response: NextResponse, pathname: string, search = '') {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = search;
  const redirect = NextResponse.redirect(url);
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

/** Runs on the Node runtime (config in src/middleware.ts): Self-Auth talks to Postgres. */
export async function updateSession(request: NextRequest) {
  const route = await routeHost(request.headers.get('host'));
  if (route.kind !== 'tenant') return blockedResponse(route.kind);
  const { tenant } = route;
  const csp = contentSecurityPolicy(tenant.supabaseUrl, process.env.NODE_ENV !== 'production');
  const withCsp = (r: NextResponse) => {
    r.headers.set('Content-Security-Policy', csp);
    return r;
  };
  // Server code always sees the routed company, never a browser-sent one.
  const response = NextResponse.next({ request: { headers: forwardHeaders(request.headers, tenant.slug) } });

  const token = request.cookies.get(SESSION_COOKIE_NAME.tenant)?.value || null;
  const auth = token ? await tenantAuth() : null;
  // Company-bound: Self-Auth only returns a session that belongs to THIS host's company.
  const session = token && auth ? await auth.getSession(token, tenant.companyId) : null;
  // No session behind the cookie (expired, revoked, disabled, or another company's): drop it.
  if (token && !session) response.cookies.set(SESSION_COOKIE_NAME.tenant, '', sessionCookieOptions(0));

  let aal: Aal = null;
  if (session && auth) {
    const needsTotp = session.aal === 'aal1' && (await auth.totp.hasTotp(session.userId));
    aal = { current: session.aal, next: needsTotp ? 'aal2' : session.aal };
  }

  const path = request.nextUrl.pathname;
  if (session && token && auth && classifyPath(path) !== 'public') {
    const raw = request.cookies.get(LAST_SEEN_COOKIE)?.value;
    const timeout = await sessionTimeoutMinutes(tenant.supabaseUrl, tenant.anonKey, await auth.issueDbToken(session));
    if (isIdleExpired(raw ? Number(raw) : null, Date.now(), timeout)) {
      await auth.signOut(token);
      response.cookies.set(SESSION_COOKIE_NAME.tenant, '', sessionCookieOptions(0));
      const redirect = redirectTo(request, response, '/login', '?reason=idle');
      redirect.cookies.delete(LAST_SEEN_COOKIE);
      return withCsp(redirect);
    }
    response.cookies.set(LAST_SEEN_COOKIE, String(Date.now()), lastSeenCookieOptions);
  }

  const target = decideRedirect({ path, hasUser: !!session, aal });
  return withCsp(target ? redirectTo(request, response, target) : response);
}

async function sessionTimeoutMinutes(url: string, anonKey: string, dbToken: string): Promise<number> {
  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${dbToken}` } },
  });
  const { data } = await supabase.from('settings').select('session_timeout_minutes').maybeSingle();
  return data?.session_timeout_minutes ?? DEFAULT_TIMEOUT_MINUTES;
}

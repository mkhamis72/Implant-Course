import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { routeHost } from '@/lib/tenant/route';
import { blockedResponse, forwardHeaders } from '@/lib/tenant/responses';
import { contentSecurityPolicy } from '@/lib/security-headers';
import { classifyPath, decideRedirect, verifiedAal, type Aal } from '@/lib/auth/redirects';
import { isIdleExpired } from '@/lib/idle';

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

export async function updateSession(request: NextRequest) {
  const route = await routeHost(request.headers.get('host'));
  if (route.kind !== 'tenant') return blockedResponse(route.kind);
  const { tenant } = route;
  const csp = contentSecurityPolicy(tenant.supabaseUrl, process.env.NODE_ENV !== 'production');
  const withCsp = (r: NextResponse) => {
    r.headers.set('Content-Security-Policy', csp);
    return r;
  };
  // Rebuilt after cookie changes too, so server code always sees the routed company, never a browser-sent one.
  const next = () => NextResponse.next({ request: { headers: forwardHeaders(request.headers, tenant.slug) } });

  let response = next();
  const supabase = createServerClient(tenant.supabaseUrl, tenant.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
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

  let aal: Aal = null;
  if (user) {
    // Factors come from the Auth server (getUser); aal from the verified JWT. Never use
    // mfa.getAuthenticatorAssuranceLevel() without a token here: it reads the editable cookie.
    const { data } = await supabase.auth.getClaims();
    aal = verifiedAal(user.factors, data?.claims?.aal);
  }

  const path = request.nextUrl.pathname;
  if (user && classifyPath(path) !== 'public') {
    const raw = request.cookies.get(LAST_SEEN_COOKIE)?.value;
    const { data: settings } = await supabase.from('settings').select('session_timeout_minutes').maybeSingle();
    const timeout = settings?.session_timeout_minutes ?? DEFAULT_TIMEOUT_MINUTES;
    if (isIdleExpired(raw ? Number(raw) : null, Date.now(), timeout)) {
      await supabase.auth.signOut({ scope: 'local' });
      const redirect = redirectTo(request, response, '/login', '?reason=idle');
      redirect.cookies.delete(LAST_SEEN_COOKIE);
      return withCsp(redirect);
    }
    response.cookies.set(LAST_SEEN_COOKIE, String(Date.now()), lastSeenCookieOptions);
  }

  const target = decideRedirect({ path, hasUser: !!user, aal });
  return withCsp(target ? redirectTo(request, response, target) : response);
}

import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Maintenance mode for the Self-Auth switch-over (docs/history/self-auth-switch-over.md §E): with MAINTENANCE=1 every host (companies,
 * console, landing) answers a static "back soon" page, except /brand/* (the logo) and static assets (the
 * middleware matcher skips those). The owner gets through for the smoke test with MAINTENANCE_BYPASS_TOKEN, sent as
 * the cookie icm_maintenance_bypass or the header x-maintenance-bypass. The token is never logged or echoed.
 */
export const MAINTENANCE_BYPASS_COOKIE = 'icm_maintenance_bypass';
export const MAINTENANCE_BYPASS_HEADER = 'x-maintenance-bypass';
const MIN_TOKEN_LENGTH = 32; // docs/history/self-auth-switch-over.md §E: "another 32+ character random value"

type Env = Record<string, string | undefined>;
type Req = { nextUrl: { pathname: string }; headers: Headers; cookies: { get(name: string): { value: string } | undefined } };

const digest = (v: string) => createHash('sha256').update(v, 'utf8').digest();

/** Constant-time comparison (equal-length digests, so the length of a guess reveals nothing). */
function matches(given: string | null | undefined, token: string): boolean {
  if (!given) return false;
  return timingSafeEqual(digest(given), digest(token));
}

function bypassed(request: Req, env: Env): boolean {
  const token = env.MAINTENANCE_BYPASS_TOKEN?.trim() ?? '';
  if (token.length < MIN_TOKEN_LENGTH) return false; // unset or too short to be a secret: nobody gets through
  return matches(request.headers.get(MAINTENANCE_BYPASS_HEADER), token)
    || matches(request.cookies.get(MAINTENANCE_BYPASS_COOKIE)?.value, token);
}

/** The "back soon" page when maintenance is on and this request may not pass; otherwise null. */
export function maintenanceResponse(request: Req, env: Env = process.env): Response | null {
  if (env.MAINTENANCE?.trim() !== '1') return null;
  const path = request.nextUrl.pathname;
  if (path === '/brand' || path.startsWith('/brand/')) return null;
  if (bypassed(request, env)) return null;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>We'll be back soon</title></head>`
    + `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#1f2933;line-height:1.5">`
    + `<h1 style="margin-bottom:.5rem">We'll be back soon</h1>`
    + `<p>We're updating the sign-in system. This takes about an hour; your data is safe.</p>`
    + `<p>Please try again later. You'll get an email when it's done.</p>`
    + `</body></html>`;
  return new Response(html, {
    status: 503,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'retry-after': '1800',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}

import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { Google, generateCodeVerifier, generateState } from 'arctic';
import { googleConfig } from '@/lib/self-auth/google-config';
import { tenantAuth } from '@/lib/self-auth/tenant';
import { currentTenant, requestOrigin } from '@/lib/tenant/current';
import { finishSignIn } from '@/lib/auth/finish-sign-in';

/** Holds `{ state, codeVerifier, nonce }` between /auth/google/start and the callback (10 minutes). */
export const GOOGLE_OAUTH_COOKIE = 'icm_google_oauth';
const COOKIE_PATH = '/auth/google';
const CALLBACK_PATH = '/auth/google/callback';

type Saved = { state: string; codeVerifier: string; nonce: string };

/** Login page error code for a refused Google sign-in. */
export function googleErrorCode(reason: string): string {
  switch (reason) {
    case 'no_account':
      return 'google_no_account';
    case 'disabled':
      return 'google_disabled';
    case 'email_not_verified':
      return 'google_unverified';
    default:
      return 'google_failed';
  }
}

function isLocalhost(origin: string): boolean {
  const host = new URL(origin).hostname;
  return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1';
}

async function client(): Promise<{ google: Google; origin: string } | null> {
  const config = googleConfig();
  if (!config) return null;
  const origin = await requestOrigin();
  return { google: new Google(config.clientId, config.clientSecret, `${origin}${CALLBACK_PATH}`), origin };
}

const notFound = () => new NextResponse(null, { status: 404 });

/** Redirects to Google with PKCE, state and nonce; 404 when Google sign-in isn't configured. */
export async function googleStart(): Promise<NextResponse> {
  const c = await client();
  if (!c) return notFound();
  const saved: Saved = { state: generateState(), codeVerifier: generateCodeVerifier(), nonce: generateState() };
  const url = c.google.createAuthorizationURL(saved.state, saved.codeVerifier, ['openid', 'email', 'profile']);
  url.searchParams.set('nonce', saved.nonce);
  const response = NextResponse.redirect(url);
  response.cookies.set(GOOGLE_OAUTH_COOKIE, JSON.stringify(saved), {
    httpOnly: true,
    secure: !isLocalhost(c.origin),
    sameSite: 'lax',
    path: COOKIE_PATH,
    maxAge: 600,
  });
  return response;
}

function parseSaved(raw: string | undefined): Saved | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Saved>;
    if (typeof v.state === 'string' && typeof v.codeVerifier === 'string' && typeof v.nonce === 'string' && v.state && v.codeVerifier && v.nonce) {
      return { state: v.state, codeVerifier: v.codeVerifier, nonce: v.nonce };
    }
  } catch {
    // Unreadable cookie: treated as missing.
  }
  return null;
}

/**
 * Google's redirect back: checks state, exchanges the code (PKCE) for an ID token and signs in through Self-Auth.
 * The oauth cookie is deleted on every outcome. On success finishSignIn redirects by throwing; never catch that.
 * Never log the code, tokens, state or verifier.
 */
export async function googleCallback(url: URL): Promise<NextResponse> {
  const c = await client();
  if (!c) return notFound();
  const jar = await cookies();
  const saved = parseSaved(jar.get(GOOGLE_OAUTH_COOKIE)?.value);
  jar.delete({ name: GOOGLE_OAUTH_COOKIE, path: COOKIE_PATH });
  const toLogin = (code: string) => NextResponse.redirect(`${c.origin}/login?error=${code}`);

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!saved || !code || !state || state !== saved.state || url.searchParams.has('error')) return toLogin('google_failed');

  let result;
  let companyId: string;
  try {
    companyId = (await currentTenant()).companyId;
    const tokens = await c.google.validateAuthorizationCode(code, saved.codeVerifier);
    result = await (await tenantAuth()).google.signIn({ companyId, idToken: tokens.idToken(), nonce: saved.nonce });
  } catch (e) {
    // Name and message only: never the code, tokens, state or verifier.
    console.error('google sign-in: failed', e instanceof Error ? `${e.name}: ${e.message}` : 'unknown error');
    return toLogin('google_failed');
  }
  if (!result.ok) return toLogin(googleErrorCode(result.reason));

  const failure = await finishSignIn({ companyId, sessionToken: result.sessionToken, session: result.session, needsTotp: result.needsTotp });
  return toLogin(failure.code === 'company' ? 'company' : 'google_failed');
}

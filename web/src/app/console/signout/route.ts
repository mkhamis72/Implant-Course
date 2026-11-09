import { NextResponse, type NextRequest } from 'next/server';
import { CONSOLE_LAST_SEEN_COOKIE } from '@/lib/console/middleware';
import { readSessionCookie } from '@/lib/self-auth/cookie';
import { consoleAuth } from '@/lib/self-auth/console';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '@/lib/self-auth/cookie-options';

const REASONS = ['not-admin', 'idle'];

/** Ends this browser's console session (only this one) and clears its cookies. */
async function endSession(response: NextResponse) {
  const token = await readSessionCookie('console');
  // A failed revoke is an error: answering as signed out would leave the session alive.
  if (token) await (await consoleAuth()).signOut(token);
  response.cookies.set(SESSION_COOKIE_NAME.console, '', sessionCookieOptions(0));
  response.cookies.delete(CONSOLE_LAST_SEEN_COOKIE);
  return response;
}

/** Guards redirect here: Server Components cannot clear cookies, route handlers can. */
export async function GET(request: NextRequest) {
  const reason = request.nextUrl.searchParams.get('reason') ?? '';
  const target = new URL('/console/login', request.url);
  if (REASONS.includes(reason)) target.searchParams.set('reason', reason);
  return endSession(NextResponse.redirect(target));
}

/** The idle timer posts here (no redirect to follow). */
export async function POST() {
  return endSession(new NextResponse(null, { status: 204 }));
}

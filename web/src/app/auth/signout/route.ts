import { NextResponse } from 'next/server';
import { tenantAuth } from '@/lib/self-auth/tenant';
import { readSessionCookie } from '@/lib/self-auth/cookie';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '@/lib/self-auth/cookie-options';
import { LAST_SEEN_COOKIE } from '@/lib/supabase/middleware';

/** Ends this browser's session (the idle timer posts here). Only this session: other devices stay signed in. */
export async function POST() {
  const token = await readSessionCookie('tenant');
  // A failed revoke is an error: answering 204 would leave the session alive behind a signed-out screen.
  if (token) await (await tenantAuth()).signOut(token);
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(SESSION_COOKIE_NAME.tenant, '', sessionCookieOptions(0));
  response.cookies.delete(LAST_SEEN_COOKIE);
  return response;
}

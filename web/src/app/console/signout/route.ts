import { NextResponse, type NextRequest } from 'next/server';
import { createConsoleClient } from '@/lib/console/supabase';
import { CONSOLE_LAST_SEEN_COOKIE } from '@/lib/console/middleware';

const REASONS = ['not-admin', 'idle'];

/** Guards redirect here: Server Components cannot clear cookies, route handlers can. */
export async function GET(request: NextRequest) {
  const supabase = await createConsoleClient();
  await supabase.auth.signOut({ scope: 'local' });
  const reason = request.nextUrl.searchParams.get('reason') ?? '';
  const target = new URL('/console/login', request.url);
  if (REASONS.includes(reason)) target.searchParams.set('reason', reason);
  const response = NextResponse.redirect(target);
  response.cookies.delete(CONSOLE_LAST_SEEN_COOKIE);
  return response;
}

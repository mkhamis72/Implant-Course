import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { routeConsole } from '@/lib/console/route';
import { consoleHost } from '@/lib/console/env';
import { updateConsoleSession } from '@/lib/console/middleware';
import { blockedResponse } from '@/lib/tenant/responses';

export async function middleware(request: NextRequest) {
  switch (routeConsole(request.headers.get('host'), request.nextUrl.pathname, consoleHost())) {
    case 'not-found':
      return blockedResponse('not-found');
    case 'console-root':
      return NextResponse.redirect(new URL('/console', request.url));
    case 'console':
      return updateConsoleSession(request);
    default:
      return updateSession(request);
  }
}

export const config = {
  runtime: 'nodejs',
  matcher: ['/((?!_next/static|_next/image|favicon.ico|[^/]+\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};

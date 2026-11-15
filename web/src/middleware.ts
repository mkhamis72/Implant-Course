import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { routeConsole } from '@/lib/console/route';
import { consoleHost } from '@/lib/console/env';
import { updateConsoleSession } from '@/lib/console/middleware';
import { blockedResponse } from '@/lib/tenant/responses';
import { isLandingHost, landingResponse, privacyResponse } from '@/lib/tenant/landing';
import { maintenanceResponse } from '@/lib/maintenance';

export async function middleware(request: NextRequest) {
  // MAINTENANCE=1 (whole-site emergency switch): every host gets the "back soon" page before any sign-in or database call.
  const maintenance = maintenanceResponse(request);
  if (maintenance) return maintenance;
  // The bare domain belongs to no company: the privacy page on /privacy, one plain page on every other path.
  if (isLandingHost(request.headers.get('host'))) {
    return request.nextUrl.pathname === '/privacy' ? privacyResponse() : landingResponse();
  }
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

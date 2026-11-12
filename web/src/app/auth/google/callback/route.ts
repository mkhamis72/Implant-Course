import type { NextRequest } from 'next/server';
import { googleCallback } from '@/lib/auth/google-flow';

/** Google's redirect back after consent. A successful sign-in redirects from inside (Next's redirect()). */
export async function GET(request: NextRequest) {
  return googleCallback(request.nextUrl);
}

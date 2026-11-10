import { googleStart } from '@/lib/auth/google-flow';

/** Starts Google sign-in (OpenID Connect, PKCE, state and nonce). 404 when Google isn't configured. */
export async function GET() {
  return googleStart();
}

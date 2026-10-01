import type { EmailOtpType } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const ALLOWED_TYPES: EmailOtpType[] = ['invite', 'recovery', 'email', 'signup'];

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get('token_hash');
  const type = params.get('type') as EmailOtpType | null;
  if (!tokenHash || !type || !ALLOWED_TYPES.includes(type)) {
    redirect('/auth/error?code=missing_token');
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    // Any verification failure (bad, used or expired token) reads as "invalid or expired".
    redirect(`/auth/error?code=${error.code === 'over_request_rate_limit' ? error.code : 'otp_expired'}`);
  }
  redirect(type === 'invite' || type === 'recovery' ? '/account/set-password' : '/');
}

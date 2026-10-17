'use server';

import { createClient } from '@/lib/supabase/server';
import { requestOrigin } from '@/lib/tenant/current';
import { emailEnabled } from '@/lib/flags';
import { forgotReply, FORGOT_SENT } from '@/lib/auth/password-reset';

export type ForgotState = { sent?: string; error?: string; email?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function requestReset(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  if (!emailEnabled()) return { error: 'Password reset by email is not available. Ask an admin to reset your password.' };
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (!EMAIL.test(email)) return { error: 'Enter your email address.', email };
  const supabase = await createClient();
  // The email links to {{ .SiteURL }}/auth/confirm?type=recovery (the recovery template); redirectTo is kept for the default template.
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${await requestOrigin()}/auth/confirm` });
  const reply = forgotReply(error);
  return reply === FORGOT_SENT ? { sent: reply } : { error: reply, email };
}

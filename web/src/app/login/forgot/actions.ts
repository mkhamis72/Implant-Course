'use server';

import { headers } from 'next/headers';
import { currentTenant } from '@/lib/tenant/current';
import { tenantAuth } from '@/lib/self-auth/tenant';
import { emailEnabled } from '@/lib/flags';
import { FORGOT_SENT, FORGOT_TOO_MANY } from '@/lib/auth/password-reset';
import { createLimiter } from '@/lib/auth/rate-limit';

export type ForgotState = { sent?: string; error?: string; email?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Self-Auth leaves rate-limiting the reset form to the app: a few links per address, more per client.
const perAddress = createLimiter(3, 15 * 60_000);
const perClient = createLimiter(10, 15 * 60_000);

export async function requestReset(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  if (!emailEnabled()) return { error: 'Password reset by email is not available. Ask an admin to reset your password.' };
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (!EMAIL.test(email)) return { error: 'Enter your email address.', email };
  const { companyId } = await currentTenant();
  const client = (await headers()).get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  // Both counters see every request, so a limited reply says nothing about whether an account exists.
  const allowed = [perClient.allow(`${companyId}|${client}`), perAddress.allow(`${companyId}|${email}`)];
  if (!allowed.every(Boolean)) return { error: FORGOT_TOO_MANY, email };
  try {
    // Always resolves for known and unknown addresses; a failed send goes to Self-Auth's onError, not here.
    await (await tenantAuth()).requestPasswordReset({ companyId, email });
  } catch (e) {
    console.error('requestReset failed', e instanceof Error ? e.name : 'error');
  }
  return { sent: FORGOT_SENT };
}

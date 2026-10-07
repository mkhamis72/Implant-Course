import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { normaliseHost } from '@/lib/tenant/host';
import { verifiedAal } from '@/lib/auth/redirects';
import { createConsoleClient, createConsoleServiceClient } from './supabase';
import { consoleHost } from './env';
import { consoleMfaStep } from './mfa-step';

export type ConsoleAdmin = { userId: string; email: string };

/** Server actions are POSTable on any host the app serves: console code runs on the console host only. */
export async function requireConsoleHost(): Promise<void> {
  const expected = consoleHost();
  if (!expected || normaliseHost((await headers()).get('host')) !== expected) notFound();
}

async function signedInListed() {
  await requireConsoleHost();
  const supabase = await createConsoleClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/console/login');
  const { data: row } = await createConsoleServiceClient().from('console_admins').select('active').eq('user_id', user.id).maybeSingle();
  if (!row?.active) {
    redirect('/console/signout?reason=not-admin');
  }
  return { supabase, user };
}

/** Signed in and listed; 2FA may still be pending (the MFA pages use this). */
export const requireConsoleUser = cache(async (): Promise<ConsoleAdmin> => {
  const { user } = await signedInListed();
  return { userId: user.id, email: user.email ?? '' };
});

/** Every console page and action: listed, verified TOTP, aal2, and the control project agrees. */
export const requireConsoleAdmin = cache(async (): Promise<ConsoleAdmin> => {
  const { supabase, user } = await signedInListed();
  const { data } = await supabase.auth.getClaims();
  const aal = verifiedAal(user.factors, data?.claims?.aal);
  const step = consoleMfaStep(user.factors, aal.current);
  if (step === 'setup') redirect('/console/mfa/setup');
  if (step === 'verify') redirect('/console/login/mfa');
  const { data: ok } = await supabase.rpc('is_console_admin');
  if (!ok) {
    redirect('/console/signout?reason=not-admin');
  }
  return { userId: user.id, email: user.email ?? '' };
});

import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { normaliseHost } from '@/lib/tenant/host';
import { consoleAuth } from '@/lib/self-auth/console';
import { currentConsoleSession } from '@/lib/self-auth/console-session';
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
  const session = await currentConsoleSession();
  if (!session) redirect('/console/login');
  const { data: row } = await createConsoleServiceClient().from('console_admins').select('active').eq('user_id', session.userId).maybeSingle();
  if (!row?.active) {
    redirect('/console/signout?reason=not-admin');
  }
  return session;
}

/** Signed in and listed; 2FA may still be pending (the MFA pages use this). */
export const requireConsoleUser = cache(async (): Promise<ConsoleAdmin> => {
  const session = await signedInListed();
  return { userId: session.userId, email: session.email };
});

/** Every console page and action: listed, confirmed TOTP, aal2, and the control project agrees. */
export const requireConsoleAdmin = cache(async (): Promise<ConsoleAdmin> => {
  const session = await signedInListed();
  const hasTotp = await (await consoleAuth()).totp.hasTotp(session.userId);
  const step = consoleMfaStep(hasTotp, session.aal);
  if (step === 'setup') redirect('/console/mfa/setup');
  if (step === 'verify') redirect('/console/login/mfa');
  const { data: ok } = await (await createConsoleClient()).rpc('is_console_admin');
  if (!ok) {
    redirect('/console/signout?reason=not-admin');
  }
  return { userId: session.userId, email: session.email };
});

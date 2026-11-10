'use server';

import { mapAuthError } from '@/lib/auth/errors';
import { finishSignIn } from '@/lib/auth/finish-sign-in';
import { tenantAuth } from '@/lib/self-auth/tenant';
import { currentTenant } from '@/lib/tenant/current';

export type LoginState = { error?: string; email?: string };

const REASON_CODES = { invalid_credentials: 'invalid_credentials', disabled: 'user_disabled', locked: 'sign_in_locked' } as const;

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const { companyId } = await currentTenant();
  // Accounts are per company: this host's company is the only one the email and password are tried against.
  const result = await (await tenantAuth()).signIn({ companyId, email, password });
  if (!result.ok) return { error: mapAuthError(REASON_CODES[result.reason] ?? 'invalid_credentials'), email };
  // Returns only on failure; on success it redirects.
  const failed = await finishSignIn({ companyId, sessionToken: result.sessionToken, session: result.session, needsTotp: result.needsTotp });
  return { error: failed.error, email };
}

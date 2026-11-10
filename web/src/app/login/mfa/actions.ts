'use server';

import { redirect } from 'next/navigation';
import { mapAuthError } from '@/lib/auth/errors';
import { readSessionCookie } from '@/lib/self-auth/cookie';
import { tenantAuth } from '@/lib/self-auth/tenant';
import { currentTenant } from '@/lib/tenant/current';

export type MfaState = { error?: string };

export async function verifyMfa(_prev: MfaState, formData: FormData): Promise<MfaState> {
  const code = String(formData.get('code') ?? '').replace(/\s/g, '');
  const token = await readSessionCookie('tenant');
  if (!token) redirect('/login');
  const { companyId } = await currentTenant();
  // The same session is raised to aal2 (its id is unchanged, so it stays bound to this company).
  const session = await (await tenantAuth()).totp.verify(token, companyId, code);
  if (!session) return { error: mapAuthError('mfa_verification_failed') };
  redirect('/');
}

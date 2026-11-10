import 'server-only';
import { cache } from 'react';
import type { Session } from '@mkhamis72/self-auth';
import { currentTenant } from '@/lib/tenant/current';
import { readSessionCookie } from './cookie';
import { tenantAuth } from './tenant';

/**
 * This request's Self-Auth session for the host's company, or null (no cookie, expired, revoked, disabled, or a
 * cookie from another company's host). Server Components cannot clear the cookie; the middleware does.
 */
export const currentSelfAuthSession = cache(async (): Promise<Session | null> => {
  const [token, tenant] = await Promise.all([readSessionCookie('tenant'), currentTenant()]);
  if (!token) return null;
  return (await tenantAuth()).getSession(token, tenant.companyId);
});

/**
 * A 5-minute database token for this request's session. Memoized per request only (React cache), never at
 * module level: the next request mints its own, so a long-lived server process never reuses an expiring token.
 */
export const requestDbToken = cache(async (): Promise<string | null> => {
  const session = await currentSelfAuthSession();
  return session ? (await tenantAuth()).issueDbToken(session) : null;
});

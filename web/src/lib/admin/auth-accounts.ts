import 'server-only';
import type { UserSummary } from '@mkhamis72/self-auth';
import { tenantAuth } from '@/lib/self-auth/tenant';
import { currentTenant } from '@/lib/tenant/current';
import { GENERIC_AUTH_ERROR } from '@/lib/auth/errors';

/** This host's Self-Auth company and instance. The company always comes from the host, never from the client. */
async function ctx() {
  const [{ companyId }, auth] = await Promise.all([currentTenant(), tenantAuth()]);
  return { companyId, auth };
}

const NOT_FOUND = 'User not found.';
const EMAIL_TAKEN = 'Another account already uses that email.';

/** The user-facing text for a Self-Auth failure. Only the error's code is read, never its message. */
function describe(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === 'user_not_found') return NOT_FOUND;
  if (code === 'email_taken') return EMAIL_TAKEN;
  if (code === 'invalid_email') return 'Enter a valid email address.';
  return GENERIC_AUTH_ERROR;
}

function logFailure(op: string, e: unknown) {
  console.error(`admin ${op} failed`, e instanceof Error ? e.name : 'error');
}

/** One account of this company, by id; null when it isn't there. Throws when Self-Auth can't answer. */
async function account(userId: string): Promise<UserSummary | null> {
  const { companyId, auth } = await ctx();
  return (await auth.admin.listUsers(companyId)).find((u) => u.userId === userId) ?? null;
}

/**
 * Deletes this company's sign-in account. Call only after delete_user / delete_delegate removed the profile: the
 * database decides whether removing is allowed, and delete_user keeps the profile of someone another company still
 * has (check with profileRemains). Returns an error message, or null.
 */
export async function deleteAuthUser(userId: string): Promise<string | null> {
  const prefix = 'The user was removed from the app, but their sign-in account was not deleted: ';
  try {
    const { companyId, auth } = await ctx();
    await auth.admin.deleteUser(companyId, userId);
    return null;
  } catch (e) {
    logFailure('deleteUser', e);
    return prefix + describe(e);
  }
}

/** Deactivates or reactivates the sign-in. Deactivating also ends this company's sessions of the account. */
export async function setAuthDisabled(userId: string, disabled: boolean): Promise<string | null> {
  try {
    const { companyId, auth } = await ctx();
    await auth.admin.setDisabled(companyId, userId, disabled);
    return null;
  } catch (e) {
    logFailure('setDisabled', e);
    return describe(e);
  }
}

/**
 * Emails the user a link to set a new password (to the address on the account; the link is never shown to the
 * admin). Also how a pending invitation is sent again: a login without a password sets its first one the same way.
 */
export async function sendPasswordLink(userId: string): Promise<{ email: string } | { error: string }> {
  try {
    const { companyId, auth } = await ctx();
    const found = (await auth.admin.listUsers(companyId)).find((u) => u.userId === userId);
    if (!found) return { error: NOT_FOUND };
    if (found.disabled) return { error: 'This account is deactivated. Reactivate it first.' };
    await auth.requestPasswordReset({ companyId, email: found.email });
    return { email: found.email };
  } catch (e) {
    logFailure('requestPasswordReset', e);
    return { error: describe(e) };
  }
}

/** signedInBefore: an established account (has a password, or a live session); sessions alone are not enough, as revoking them clears lastSignInAt. */
export type PreviousAccount = { email: string; signedInBefore: boolean };

/** Sets a login's sign-in email. Returns the address it had, so the caller can put it back, and whether the user ever signed in. */
export async function changeAuthEmail(userId: string, email: string): Promise<{ previous: PreviousAccount } | { error: string }> {
  try {
    const { companyId, auth } = await ctx();
    const found = (await auth.admin.listUsers(companyId)).find((u) => u.userId === userId);
    if (!found) return { error: NOT_FOUND };
    if (found.email.toLowerCase() === email.toLowerCase()) return { error: 'That is already their sign-in email.' };
    await auth.admin.updateEmail(companyId, userId, email);
    return { previous: { email: found.email, signedInBefore: found.hasPassword || found.lastSignInAt !== null } };
  } catch (e) {
    logFailure('updateEmail', e);
    return { error: describe(e) };
  }
}

/** Removes the authenticator and ends the account's sessions (Reset 2FA; the action decides whether a reset is allowed). */
export async function resetAuthFactors(userId: string): Promise<string | null> {
  try {
    const { companyId, auth } = await ctx();
    await auth.admin.resetTotp(companyId, userId);
    return null;
  } catch (e) {
    logFailure('resetTotp', e);
    return describe(e);
  }
}

/** Whether the login has a confirmed authenticator (Reset 2FA is offered only then); null when Self-Auth can't say. */
export async function hasVerifiedFactor(userId: string): Promise<boolean | null> {
  try {
    return (await account(userId))?.hasTotp ?? false;
  } catch (e) {
    logFailure('listUsers', e);
    return null;
  }
}

export type AccountState = { lastSignIn: string | null; hasFactor: boolean; hasPassword: boolean };

/** This company's accounts by user id (sign-in time, authenticator, password). Throws when Self-Auth can't answer: "Never" would be wrong. */
export async function listAccounts(): Promise<Map<string, AccountState>> {
  const { companyId, auth } = await ctx();
  const rows = await auth.admin.listUsers(companyId);
  return new Map(rows.map((u) => [u.userId, {
    lastSignIn: u.lastSignInAt ? u.lastSignInAt.toISOString() : null, hasFactor: u.hasTotp, hasPassword: u.hasPassword,
  }]));
}

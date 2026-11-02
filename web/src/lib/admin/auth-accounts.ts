import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { mapAuthError } from '@/lib/auth/errors';
import { requestOrigin } from '@/lib/tenant/current';
import { temporaryPassword } from './passwords';

/**
 * Deletes a sign-in account. Call only after delete_user / delete_delegate removed the profile: the database
 * decides whether removing is allowed, and delete_user keeps the profile of someone another company still has
 * (check with profileRemains). Returns an error message, or null.
 */
export async function deleteAuthUser(userId: string): Promise<string | null> {
  const prefix = 'The user was removed from the app, but their sign-in account was not deleted: ';
  let admin;
  try {
    admin = await createAdminClient();
  } catch (error) {
    return prefix + (error as Error).message;
  }
  const { error } = await admin.auth.admin.deleteUser(userId);
  return error ? prefix + mapAuthError(error) : null;
}

/** Replaces a login's password with a new one-time password for the admin to hand over. */
export async function setTemporaryPassword(userId: string): Promise<{ password: string } | { error: string }> {
  let admin;
  try {
    admin = await createAdminClient();
  } catch (error) {
    return { error: (error as Error).message };
  }
  const password = temporaryPassword();
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  return error ? { error: mapAuthError(error) } : { password };
}

async function adminAuth() {
  return (await createAdminClient()).auth.admin;
}

export type PreviousAccount = { email: string; signedInBefore: boolean };

/**
 * Sets a login's sign-in email (Auth moves the email identity with it). Returns the address it
 * had, so the caller can put it back, and whether the user ever signed in.
 */
export async function changeAuthEmail(userId: string, email: string): Promise<{ previous: PreviousAccount } | { error: string }> {
  try {
    const auth = await adminAuth();
    const { data, error: readError } = await auth.getUserById(userId);
    if (readError || !data?.user) return { error: mapAuthError(readError) };
    const previous = { email: data.user.email ?? '', signedInBefore: !!data.user.last_sign_in_at };
    if (previous.email.toLowerCase() === email) return { error: 'That is already their sign-in email.' };
    // Confirmed only if it was: a pending invite stays pending, so it can be resent to the corrected address.
    const { error } = await auth.updateUserById(userId, data.user.email_confirmed_at ? { email, email_confirm: true } : { email });
    if (error) {
      const message = mapAuthError(error);
      return { error: message === mapAuthError('email_exists') ? 'Another account already uses that email.' : message };
    }
    return { previous };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/**
 * Deletes every factor of a login (Reset 2FA; the action decides whether a reset is allowed). Returns an error
 * message, or null.
 */
export async function resetAuthFactors(userId: string): Promise<string | null> {
  try {
    const auth = await adminAuth();
    const { data, error } = await auth.mfa.listFactors({ userId });
    if (error) return mapAuthError(error);
    for (const factor of data?.factors ?? []) {
      const { error: deleteError } = await auth.mfa.deleteFactor({ id: factor.id, userId });
      if (deleteError) return mapAuthError(deleteError);
    }
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

/** Whether the login has a verified 2FA factor (Reset 2FA is offered only then); null when Auth can't say. */
export async function hasVerifiedFactor(userId: string): Promise<boolean | null> {
  try {
    const { data, error } = await (await adminAuth()).mfa.listFactors({ userId });
    if (error) return null;
    return (data?.factors ?? []).some((f) => f.status === 'verified');
  } catch {
    return null;
  }
}

const USERS_PER_PAGE = 1000;

/** The given members' last sign-in (null = never), by user id. Throws when Auth can't answer: "Never" would be wrong. */
export async function listSignIns(userIds: string[]): Promise<Map<string, string | null>> {
  const wanted = new Set(userIds);
  const auth = await adminAuth();
  const signIns = new Map<string, string | null>();
  for (let page = 1; ; page++) {
    const { data, error } = await auth.listUsers({ page, perPage: USERS_PER_PAGE });
    if (error) throw new Error(`Could not load sign-in times: ${error.message}`);
    for (const user of data.users) if (wanted.has(user.id)) signIns.set(user.id, user.last_sign_in_at ?? null);
    if (data.users.length < USERS_PER_PAGE) return signIns;
  }
}

/**
 * A fresh invitation link for a login that never signed in, on this request's own (routed) host, in the same
 * /auth/confirm form the Supabase invite template uses.
 */
export async function inviteLink(userId: string): Promise<{ email: string; link: string } | { error: string }> {
  try {
    const auth = await adminAuth();
    const { data, error: readError } = await auth.getUserById(userId);
    if (readError || !data?.user?.email) return { error: mapAuthError(readError) };
    const { user } = data;
    if (user.last_sign_in_at) return { error: 'This user has already signed in.' };
    // Confirmed already (made while email was off): Auth won't invite the address again.
    if (user.email_confirmed_at) {
      return { error: "This login's email is already confirmed, so there is no invite to resend. Use Reset password instead." };
    }
    const { data: link, error } = await auth.generateLink({ type: 'invite', email: user.email! });
    if (error || !link?.properties?.hashed_token) return { error: mapAuthError(error) };
    const origin = await requestOrigin();
    return {
      email: user.email!,
      link: `${origin}/auth/confirm?token_hash=${encodeURIComponent(link.properties.hashed_token)}&type=invite`,
    };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

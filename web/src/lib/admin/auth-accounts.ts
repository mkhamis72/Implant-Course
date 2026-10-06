import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { mapAuthError } from '@/lib/auth/errors';
import { temporaryPassword } from './passwords';

/**
 * Deletes a sign-in account. Call only after delete_user / delete_delegate removed the profile: the database
 * decides whether removing is allowed. Returns an error message, or null.
 */
export async function deleteAuthUser(userId: string): Promise<string | null> {
  const { error } = await createAdminClient().auth.admin.deleteUser(userId);
  return error ? `The user was removed from the app, but their sign-in account was not deleted: ${mapAuthError(error)}` : null;
}

/** Replaces a login's password with a new one-time password for the admin to hand over. */
export async function setTemporaryPassword(userId: string): Promise<{ password: string } | { error: string }> {
  const password = temporaryPassword();
  const { error } = await createAdminClient().auth.admin.updateUserById(userId, { password });
  return error ? { error: mapAuthError(error) } : { password };
}

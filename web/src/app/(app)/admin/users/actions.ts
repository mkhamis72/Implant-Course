'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/session';
import { mapAuthError } from '@/lib/auth/errors';
import { inviteSchema, permissionsSchema, setActiveSchema, setRoleSchema, type ActionState } from '@/lib/admin/schemas';
import { createLogin } from '@/lib/admin/create-login';
import { userMessage } from '@/lib/db-errors';
import { updateProblem } from '@/lib/admin/results';
import { deleteAuthUser, setTemporaryPassword } from '@/lib/admin/auth-accounts';
import type { FormState } from '@/lib/patients/form-state';
import { z } from 'zod';

/** Email on: an invitation that verifies the address. Email off: a login with a one-time password. */
export async function inviteUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const result = await createLogin(parsed.data);
  if ('error' in result) return result;
  revalidatePath('/admin/users');
  return result;
}

export async function savePermissions(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = permissionsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Choose None, View or Edit for every panel.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_user_permissions', { p_user: parsed.data.user_id, p_perms: parsed.data.perms });
  if (error) return { error: userMessage(error)! };
  revalidatePath('/admin/users');
  return { ok: 'Permissions saved.' };
}

export async function setUserRole(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireAdmin();
  const parsed = setRoleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Invalid request.' };
  if (parsed.data.user_id === me.user_id) return { error: 'You cannot change your own role.' };
  const supabase = await createClient();
  const problem = updateProblem(
    await supabase.from('profiles').update({ role: parsed.data.role }).eq('user_id', parsed.data.user_id).select('user_id'),
  );
  if (problem) return { error: problem };
  revalidatePath('/admin/users');
  return { ok: 'Role updated.' };
}

export async function setUserActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireAdmin();
  const parsed = setActiveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Invalid request.' };
  const { user_id, active } = parsed.data;
  if (user_id === me.user_id) return { error: 'You cannot deactivate your own account.' };

  const supabase = await createClient();
  const problem = updateProblem(
    await supabase.from('profiles').update({ active }).eq('user_id', user_id).select('user_id'),
  );
  if (problem) return { error: problem };

  // Ban/unban in Auth so a deactivated user cannot sign in or refresh their session.
  const { error: banError } = await createAdminClient().auth.admin.updateUserById(user_id, {
    ban_duration: active ? 'none' : '876000h',
  });
  if (banError) return { error: mapAuthError(banError) };

  revalidatePath('/admin/users');
  return { ok: active ? 'User reactivated.' : 'User deactivated.' };
}

/** Removes a user without records (test or mistaken accounts); the database refuses anyone with records. */
export async function removeUser(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('delete_user', { p_user: id.data });
  if (error) return { error: userMessage(error)! };
  const authError = await deleteAuthUser(id.data);
  revalidatePath('/admin/users');
  return authError ? { error: authError } : { ok: 'User removed.' };
}

/** A new one-time password for someone who lost theirs (works with email on or off). */
export async function resetPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireAdmin();
  const userId = String(formData.get('user_id') ?? '');
  if (userId === me.user_id) return { error: 'Change your own password under Account security.' };
  if (!z.string().uuid().safeParse(userId).success) return { error: 'Invalid request.' };
  const result = await setTemporaryPassword(userId);
  if ('error' in result) return result;
  return { ok: 'New one-time password set.', password: result.password };
}

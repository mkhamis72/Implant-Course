'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/session';
import { mapAuthError } from '@/lib/auth/errors';
import { serverEnv } from '@/lib/env';
import { inviteSchema, setActiveSchema, setRoleSchema, type ActionState } from '@/lib/admin/schemas';

const LAST_ADMIN = 'At least one active admin is required.';

export async function inviteUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { email, full_name, role } = parsed.data;

  const { data, error } = await createAdminClient().auth.admin.inviteUserByEmail(email, {
    redirectTo: `${serverEnv().siteUrl}/auth/confirm`,
  });
  if (error) return { error: mapAuthError(error) };

  // Activate through the admin's own session so RLS and the audit log record who did it.
  const supabase = await createClient();
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ full_name, role, active: true })
    .eq('user_id', data.user.id);
  if (profileError) return { error: profileError.message };

  revalidatePath('/admin/users');
  return { ok: `Invitation sent to ${email}.` };
}

export async function setUserRole(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireAdmin();
  const parsed = setRoleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'Invalid request.' };
  if (parsed.data.user_id === me.user_id) return { error: 'You cannot change your own role.' };
  const supabase = await createClient();
  const { error } = await supabase.from('profiles').update({ role: parsed.data.role }).eq('user_id', parsed.data.user_id);
  if (error) return { error: error.hint === 'last_admin' ? LAST_ADMIN : error.message };
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
  const { error } = await supabase.from('profiles').update({ active }).eq('user_id', user_id);
  if (error) return { error: error.hint === 'last_admin' ? LAST_ADMIN : error.message };

  // Ban/unban in Auth so a deactivated user cannot sign in or refresh their session.
  const { error: banError } = await createAdminClient().auth.admin.updateUserById(user_id, {
    ban_duration: active ? 'none' : '876000h',
  });
  if (banError) return { error: mapAuthError(banError) };

  revalidatePath('/admin/users');
  return { ok: active ? 'User reactivated.' : 'User deactivated.' };
}

'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/session';
import { mapAuthError } from '@/lib/auth/errors';
import { serverEnv } from '@/lib/env';
import { inviteSchema, setActiveSchema, setRoleSchema, type ActionState } from '@/lib/admin/schemas';
import { updateProblem } from '@/lib/admin/results';
import { EMAIL_OFF_MESSAGE, emailEnabled } from '@/lib/flags';

export async function inviteUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  if (!emailEnabled()) return { error: EMAIL_OFF_MESSAGE };
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { email, full_name, role } = parsed.data;

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${serverEnv().siteUrl}/auth/confirm`,
  });
  if (error) return { error: mapAuthError(error) };

  // Activate through the admin's own session so RLS and the audit log record who did it.
  const supabase = await createClient();
  const problem = updateProblem(
    await supabase.from('profiles').update({ full_name, role, active: true }).eq('user_id', data.user.id).select('user_id'),
  );
  if (problem) {
    // Don't leave an invited-but-inactive account behind: the invitee would land on "Account deactivated".
    await admin.auth.admin.deleteUser(data.user.id);
    return { error: `The invitation was cancelled: ${problem}` };
  }

  revalidatePath('/admin/users');
  return { ok: `Invitation sent to ${email}.` };
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

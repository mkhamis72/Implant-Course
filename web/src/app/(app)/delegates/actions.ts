'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { currentTenant } from '@/lib/tenant/current';
import { requireAdmin, requirePermission } from '@/lib/auth/session';
import { createLogin } from '@/lib/admin/create-login';
import { deleteAuthUser } from '@/lib/admin/auth-accounts';
import { profileRemains } from '@/lib/admin/same-company';
import type { ActionState } from '@/lib/admin/schemas';
import { delegateSchema } from '@/lib/inventory/schemas';
import { failed, type FormState } from '@/lib/patients/form-state';
import { userMessage } from '@/lib/db-errors';

export async function createDelegate(_prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission('delegates', 'edit');
  const parsed = delegateSchema.safeParse({ ...Object.fromEntries(formData), active: 'on' });
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('delegates').insert(parsed.data);
  if (error) return failed(userMessage(error)!, formData);
  revalidatePath('/delegates');
  return { ok: `${parsed.data.full_name} added.` };
}

export async function updateDelegate(_prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission('delegates', 'edit');
  const id = String(formData.get('id') ?? '');
  const parsed = delegateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { data, error } = await supabase.from('delegates').update(parsed.data).eq('id', id).select('id');
  if (error || !data?.length) return failed(userMessage(error) ?? 'Delegate not found.', formData);
  revalidatePath('/delegates');
  revalidatePath(`/delegates/${id}`);
  return { ok: 'Delegate saved.' };
}

/** Admins give a delegate a login that sees only their own schedule and report. */
export async function createDelegateLogin(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = String(formData.get('delegate_id') ?? '');
  const supabase = await createClient();
  const { data: d } = await supabase.from('delegates').select('id, full_name, email').eq('id', id).maybeSingle();
  if (!d) return { error: 'Delegate not found.' };
  if (!d.email) return { error: 'Add the delegate’s email address first.' };
  const { companyId } = await currentTenant();
  const { data: login } = await supabase
    .from('company_members')
    .select('user_id')
    .eq('company_id', companyId)
    .eq('delegate_id', id)
    .maybeSingle();
  if (login) return { error: 'This delegate already has a login.' };
  const result = await createLogin({ email: String(d.email).trim().toLowerCase(), full_name: d.full_name, role: 'delegate', delegate_id: d.id });
  if ('error' in result) return result;
  revalidatePath(`/delegates/${id}`);
  return result;
}

/** Removes a delegate added by mistake; the database refuses one with implant records or surgery bookings. */
export async function deleteDelegate(_prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission('delegates', 'edit');
  const id = String(formData.get('id') ?? '');
  const supabase = await createClient();
  const { data: login, error } = await supabase.rpc('delete_delegate', { p_delegate: id });
  if (error) return { error: userMessage(error)! };
  revalidatePath('/delegates');
  revalidatePath('/admin/users');
  if (login) {
    // The login goes with the delegate unless another company keeps its profile: then the sign-in stays too.
    const remains = await profileRemains(login as string);
    if (remains === null) {
      return { error: "The delegate was removed, but it couldn't be checked whether their sign-in account can be deleted." };
    }
    const authError = remains ? null : await deleteAuthUser(login as string);
    if (authError) return { error: authError };
  }
  redirect('/delegates');
}

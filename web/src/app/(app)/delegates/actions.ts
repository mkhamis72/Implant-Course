'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin, requirePermission } from '@/lib/auth/session';
import { createLogin } from '@/lib/admin/create-login';
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
  const result = await createLogin({ email: String(d.email).trim().toLowerCase(), full_name: d.full_name, role: 'delegate', delegate_id: d.id });
  if ('error' in result) return result;
  revalidatePath(`/delegates/${id}`);
  return result;
}

'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
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

'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { chairSchema } from '@/lib/schedule/schemas';
import { failed, type FormState } from '@/lib/patients/form-state';
import { userMessage } from '@/lib/db-errors';

function chairError(error: { code?: string; message: string; hint?: string | null }): string {
  return error.code === '23505' ? 'A chair with this name already exists.' : userMessage(error)!;
}

export async function addChair(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = chairSchema.safeParse({ name: formData.get('name') });
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('chairs').insert({ name: parsed.data.name });
  if (error) return failed(chairError(error), formData);
  revalidatePath('/admin/chairs');
  return { ok: 'Chair added.' };
}

export async function updateChair(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = chairSchema.safeParse({ name: formData.get('name') });
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('chairs')
    .update({ name: parsed.data.name, active: formData.get('active') === 'on' })
    .eq('id', String(formData.get('id')))
    .select('id');
  if (error || !data?.length) return failed(error ? chairError(error) : 'Chair not found.', formData);
  revalidatePath('/admin/chairs');
  return { ok: 'Saved.' };
}

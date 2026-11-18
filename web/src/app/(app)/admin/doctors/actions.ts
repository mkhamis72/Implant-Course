'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { doctorSchema } from '@/lib/schedule/schemas';
import { failed, type FormState } from '@/lib/patients/form-state';
import { userMessage } from '@/lib/db-errors';

export async function addDoctor(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = doctorSchema.safeParse({ name: formData.get('name') });
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('doctors').insert({ name: parsed.data.name });
  if (error) return failed(userMessage(error)!, formData);
  revalidatePath('/admin/doctors');
  return { ok: 'Doctor added.' };
}

export async function updateDoctor(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = doctorSchema.safeParse({ name: formData.get('name') });
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('doctors')
    .update({ name: parsed.data.name, active: formData.get('active') === 'on' })
    .eq('id', String(formData.get('id')))
    .select('id');
  if (error || !data?.length) return failed(error ? userMessage(error)! : 'Doctor not found.', formData);
  revalidatePath('/admin/doctors');
  return { ok: 'Saved.' };
}

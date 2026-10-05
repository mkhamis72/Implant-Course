'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { lecturerSchema } from '@/lib/schedule/schemas';
import { failed, type FormState } from '@/lib/patients/form-state';
import { userMessage } from '@/lib/db-errors';

export async function addLecturer(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = lecturerSchema.safeParse({ full_name: formData.get('full_name') });
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('lecturers').insert({ full_name: parsed.data.full_name });
  if (error) return failed(userMessage(error)!, formData);
  revalidatePath('/admin/lecturers');
  return { ok: 'Lecturer added.' };
}

export async function updateLecturer(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = lecturerSchema.safeParse({ full_name: formData.get('full_name') });
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('lecturers')
    .update({ full_name: parsed.data.full_name, active: formData.get('active') === 'on' })
    .eq('id', String(formData.get('id')))
    .select('id');
  if (error || !data?.length) return failed(error ? userMessage(error)! : 'Lecturer not found.', formData);
  revalidatePath('/admin/lecturers');
  return { ok: 'Saved.' };
}

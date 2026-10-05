'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { noteSchema } from '@/lib/patients/schemas';
import { failed, type FormState } from '@/lib/patients/form-state';

export async function addNote(_prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission('patients', 'edit');
  const patientId = String(formData.get('patient_id') ?? '');
  const parsed = noteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('visit_notes').insert({ patient_id: patientId, ...parsed.data });
  if (error) {
    console.error('Note save failed:', error.message);
    return failed('The note could not be saved. Please try again.', formData);
  }
  revalidatePath(`/patients/${patientId}/notes`);
  return { ok: 'Note added.' };
}

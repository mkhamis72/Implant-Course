'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { medicalHistorySchema } from '@/lib/patients/schemas';
import { failed, type FormState } from '@/lib/patients/form-state';
import { staleMessage } from '@/lib/patients/conflict-server';

export async function saveMedicalHistory(_prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission('patients', 'edit');
  const patientId = String(formData.get('patient_id') ?? '');
  const expected = String(formData.get('expected_updated_at') ?? '');
  const parsed = medicalHistorySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('medical_history')
    .update(parsed.data)
    .eq('patient_id', patientId)
    .eq('updated_at', expected)
    .select('patient_id');
  if (error) {
    console.error('Medical history save failed:', error.message);
    return failed('The medical history could not be saved. Please try again.', formData);
  }
  if (!data?.length) return failed(await staleMessage(supabase, 'medical_history', patientId), formData);
  revalidatePath(`/patients/${patientId}`, 'layout');
  return { ok: 'Medical history saved.' };
}

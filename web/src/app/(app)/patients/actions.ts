'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireActiveUser } from '@/lib/auth/session';
import { patientSchema, toPatientRow } from '@/lib/patients/schemas';
import { failed, type FormState } from '@/lib/patients/form-state';
import { staleMessage } from '@/lib/patients/conflict-server';
import { patientSaveError } from '@/lib/patients/save-errors';
import { userMessage } from '@/lib/db-errors';


export async function createPatient(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const parsed = patientSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { data, error } = await supabase.from('patients').insert(toPatientRow(parsed.data)).select('id').single();
  if (error) return failed(patientSaveError(error, parsed.data.file_no), formData);
  redirect(`/patients/${data.id}`);
}

export async function updatePatient(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const id = String(formData.get('id') ?? '');
  const expected = String(formData.get('expected_updated_at') ?? '');
  const parsed = patientSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('patients')
    .update(toPatientRow(parsed.data))
    .eq('id', id)
    .eq('updated_at', expected)
    .select('id');
  if (error) return failed(patientSaveError(error, parsed.data.file_no), formData);
  if (!data?.length) return failed(await staleMessage(supabase, 'patients', id), formData);
  revalidatePath(`/patients/${id}`, 'layout');
  return { ok: 'Patient details saved.' };
}

export async function deletePatient(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const id = String(formData.get('id') ?? '');
  const supabase = await createClient();
  const { error } = await supabase.rpc('delete_patient', { p_patient: id });
  if (error) return { error: userMessage(error)! };
  revalidatePath('/patients');
  revalidatePath('/schedule');
  redirect('/patients');
}

export async function setArchived(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const id = String(formData.get('id') ?? '');
  const archived = formData.get('archived') === 'true';
  const supabase = await createClient();
  const { data, error } = await supabase.from('patients').update({ archived }).eq('id', id).select('id');
  if (error || !data?.length) return { error: 'The patient could not be updated. Please try again.' };
  revalidatePath(`/patients/${id}`, 'layout');
  return { ok: archived ? 'Patient archived.' : 'Patient restored.' };
}

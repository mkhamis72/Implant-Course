'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { doctorSchema } from '@/lib/schedule/schemas';
import { failed, type FormState } from '@/lib/patients/form-state';
import { userMessage } from '@/lib/db-errors';
import { z } from 'zod';

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

/** Links a staff login to the doctor (Placed by then starts on that doctor for them), or unlinks it (empty login). */
export async function setDoctorLogin(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = z
    .object({ id: z.string().uuid(), user_id: z.union([z.literal(''), z.string().uuid()]) })
    .safeParse({ id: formData.get('id'), user_id: formData.get('user_id') ?? '' });
  if (!parsed.success) return { error: 'Invalid request.' };
  const supabase = await createClient();
  // An empty login unlinks; with no login linked there is nothing to unlink, so the admin chose nothing.
  if (!parsed.data.user_id) {
    const { data: doctor } = await supabase.from('doctors').select('user_id').eq('id', parsed.data.id).maybeSingle();
    if (!doctor?.user_id) return { error: 'Choose a login.' };
  }
  const { error } = await supabase.rpc('set_doctor_login', { p_doctor: parsed.data.id, p_user: parsed.data.user_id || null });
  if (error) return { error: userMessage(error)! };
  revalidatePath('/admin/doctors');
  return { ok: parsed.data.user_id ? 'Login linked.' : 'Login unlinked.' };
}

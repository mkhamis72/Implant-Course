'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireActiveUser } from '@/lib/auth/session';
import { cancelSlotSchema, slotSchema } from '@/lib/schedule/schemas';
import type { FormState } from '@/lib/patients/form-state';
import { userMessage } from '@/lib/db-errors';

type BookResult = { error?: string; warnings?: string[]; slotId?: string; date?: string };

export async function bookSurgery(input: Record<string, unknown>): Promise<BookResult> {
  await requireActiveUser();
  const parsed = slotSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const s = parsed.data;
  const supabase = await createClient();

  const { data: patient } = await supabase.from('patients').select('id').eq('file_no', s.patientFileNo).maybeSingle();
  if (!patient) return { error: `No patient has file number ${s.patientFileNo}. Choose a patient from the list.` };
  const { data: session } = await supabase.from('sessions').select('date').eq('id', s.sessionId).maybeSingle();
  if (!session) return { error: 'Choose a surgery session.' };

  if (s.overrideReason.length < 3) {
    const { data: clashes, error } = await supabase.rpc('slot_conflicts', {
      p_session: s.sessionId, p_chair: s.chairId, p_start: s.start, p_end: s.end, p_patient: patient.id,
      p_supervisor: s.supervisorId, p_delegates: [...s.placing, ...s.assisting],
    });
    if (error) return { error: userMessage(error)! };
    if (clashes?.length) return { warnings: (clashes as { message: string }[]).map((c) => c.message) };
  }

  const { data: slotId, error } = await supabase.rpc('create_surgery_slot', {
    p_session: s.sessionId, p_chair: s.chairId, p_start: s.start, p_end: s.end, p_patient: patient.id,
    p_supervisor: s.supervisorId, p_placing: s.placing, p_assisting: s.assisting,
    p_implants: s.implants.map((i) => ({ tooth: i.tooth, product_id: i.productId })),
    p_override_reason: s.overrideReason, p_notes: s.notes,
  });
  if (error) return { error: userMessage(error)! };
  revalidatePath('/schedule');
  revalidatePath(`/patients/${patient.id}`, 'layout');
  return { slotId: slotId as string, date: session.date as string };
}

export async function cancelBooking(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const parsed = cancelSlotSchema.safeParse({ slotId: formData.get('slot_id'), reason: formData.get('reason') });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc('cancel_surgery_slot', { p_slot: parsed.data.slotId, p_reason: parsed.data.reason });
  if (error) return { error: userMessage(error)! };
  revalidatePath('/schedule');
  return { ok: 'Booking cancelled.' };
}

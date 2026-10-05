'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { cancelSlotSchema, slotSchema, slotStatusSchema, updateSlotSchema } from '@/lib/schedule/schemas';
import type { FormState } from '@/lib/patients/form-state';
import { userMessage } from '@/lib/db-errors';
import { escapeLike } from '@/lib/like';

type BookResult = { error?: string; warnings?: string[]; slotId?: string; date?: string };

export async function bookSurgery(input: Record<string, unknown>): Promise<BookResult> {
  await requirePermission('schedule', 'edit');
  const parsed = slotSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const s = parsed.data;
  const supabase = await createClient();

  // File numbers are matched without regard to case; an exact match wins if two differ only by case.
  const { data: matches } = await supabase.from('patients').select('id, file_no').ilike('file_no', escapeLike(s.patientFileNo)).limit(2);
  const patient = matches?.find((m) => m.file_no === s.patientFileNo) ?? (matches?.length === 1 ? matches[0] : null);
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
    p_implants: s.implants.map((i) => ({ tooth: i.tooth, product_id: i.productId, technique: i.technique })),
    p_override_reason: s.overrideReason, p_notes: s.notes,
  });
  if (error) return { error: userMessage(error)! };
  revalidatePath('/schedule');
  revalidatePath(`/patients/${patient.id}`, 'layout');
  return { slotId: slotId as string, date: session.date as string };
}

export async function updateBooking(input: Record<string, unknown>): Promise<BookResult> {
  await requirePermission('schedule', 'edit');
  const parsed = updateSlotSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const s = parsed.data;
  const supabase = await createClient();
  const { data: slot } = await supabase
    .from('surgery_slots').select('patient_id, session_id, session:sessions(date)').eq('id', s.slotId).maybeSingle();
  if (!slot) return { error: 'Booking not found.' };
  const date = (slot.session as unknown as { date: string } | null)?.date;

  if (s.overrideReason.length < 3) {
    const { data: clashes, error } = await supabase.rpc('slot_conflicts', {
      p_session: slot.session_id, p_chair: s.chairId, p_start: s.start, p_end: s.end, p_patient: slot.patient_id,
      p_supervisor: s.supervisorId, p_delegates: [...s.placing, ...s.assisting], p_exclude: s.slotId,
    });
    if (error) return { error: userMessage(error)! };
    if (clashes?.length) return { warnings: (clashes as { message: string }[]).map((c) => c.message) };
  }

  const { error } = await supabase.rpc('update_surgery_slot', {
    p_slot: s.slotId, p_chair: s.chairId, p_start: s.start, p_end: s.end, p_supervisor: s.supervisorId,
    p_placing: s.placing, p_assisting: s.assisting, p_override_reason: s.overrideReason, p_notes: s.notes,
  });
  if (error) return { error: userMessage(error)! };
  for (const i of s.implants) {
    const { error: techError } = await supabase.rpc('set_implant_technique', { p_site: i.siteId, p_technique: i.technique });
    if (techError) return { error: userMessage(techError)! };
  }
  revalidatePath('/schedule');
  revalidatePath(`/patients/${slot.patient_id}`, 'layout');
  return { slotId: s.slotId, date };
}

export async function setBookingStatus(_prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission('schedule', 'edit');
  const parsed = slotStatusSchema.safeParse({ slotId: formData.get('slot_id'), status: formData.get('status') });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_slot_status', { p_slot: parsed.data.slotId, p_status: parsed.data.status });
  if (error) return { error: userMessage(error)! };
  revalidatePath('/schedule');
  return { ok: parsed.data.status === 'done' ? 'Marked completed.' : 'Reopened.' };
}

export async function cancelBooking(_prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission('schedule', 'edit');
  const parsed = cancelSlotSchema.safeParse({ slotId: formData.get('slot_id'), reason: formData.get('reason') });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc('cancel_surgery_slot', { p_slot: parsed.data.slotId, p_reason: parsed.data.reason });
  if (error) return { error: userMessage(error)! };
  revalidatePath('/schedule');
  return { ok: 'Booking cancelled.' };
}

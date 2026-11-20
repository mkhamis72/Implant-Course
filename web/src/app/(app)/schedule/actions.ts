'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { cancelSlotSchema, clinicDaySchema, slotSchema, slotStatusSchema, surgeryDaySchema, updateSlotSchema } from '@/lib/schedule/schemas';
import { failed, type FormState } from '@/lib/patients/form-state';
import { userMessage } from '@/lib/db-errors';
import { escapeLike } from '@/lib/like';
import { teachingOn } from '@/lib/modules/modules';
import { placedByRecordedDelegates, type RecordedPeople } from '@/lib/schedule/recorded';

type BookResult = { error?: string; warnings?: string[]; slotId?: string; date?: string };

/**
 * A clinic books a doctor only: whatever the client sent, no supervisor or delegates go to the database. A course
 * organizer chooses delegates or a doctor (`recorded` is the action's own, below).
 */
function forPlan(input: Record<string, unknown>, teaching: boolean): Record<string, unknown> {
  return teaching
    ? { ...input, clinic: false, placedBy: input.placedBy === 'doctor' ? 'doctor' : 'delegate' }
    : { ...input, clinic: true, placedBy: 'doctor', supervisorId: null, placing: [], assisting: [] };
}

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * The clinic day a clinic booking on this date goes to, if there is one yet: the earliest course-less surgery session
 * that day, as app_private.clinic_day picks it (0122). Only for the clash pre-check; the database makes the day.
 */
async function clinicDayOn(supabase: Client, date: string): Promise<string | null> {
  const { data } = await supabase
    .from('sessions').select('id').eq('type', 'surgery').eq('date', date).is('course_id', null)
    .order('start_time').order('created_at').order('id').limit(1).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * Editing in a clinic: what the booking recorded before the switch (supervisor, delegates) is hidden but kept, so
 * the recorded supervisor goes back and no delegates are sent (update_surgery_slot_v2 keeps them, 0120). A booking
 * placed by its recorded delegates takes no doctor.
 */
function forClinicEdit(input: Record<string, unknown>, slot: RecordedPeople): Record<string, unknown> {
  const recorded = placedByRecordedDelegates(slot);
  return {
    ...input,
    clinic: true,
    placedBy: recorded ? 'recorded' : 'doctor',
    placingDoctorId: recorded ? null : input.placingDoctorId,
    supervisorId: slot.supervisor_id,
    placing: [],
    assisting: [],
  };
}

export async function bookSurgery(input: Record<string, unknown>): Promise<BookResult> {
  const profile = await requirePermission('schedule', 'edit');
  const parsed = slotSchema.safeParse(forPlan(input, teachingOn(profile.features)));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const s = parsed.data;
  const supabase = await createClient();

  // File numbers are matched without regard to case; an exact match wins if two differ only by case.
  const { data: matches } = await supabase.from('patients').select('id, file_no').ilike('file_no', escapeLike(s.patientFileNo)).limit(2);
  const patient = matches?.find((m) => m.file_no === s.patientFileNo) ?? (matches?.length === 1 ? matches[0] : null);
  if (!patient) return { error: `No patient has file number ${s.patientFileNo}. Choose a patient from the list.` };
  // A clinic books by date: the database finds or makes that date's clinic day.
  let date = s.date;
  if (s.sessionId) {
    const { data: session } = await supabase.from('sessions').select('date').eq('id', s.sessionId).maybeSingle();
    if (!session) return { error: 'Choose a surgery session.' };
    date = session.date as string;
  }
  // Clashes are checked against the session; a date with no clinic day yet has nothing to clash with.
  const clashSession = s.sessionId ?? (await clinicDayOn(supabase, date!));

  if (s.overrideReason.length < 3 && clashSession) {
    const { data: clashes, error } = await supabase.rpc('slot_conflicts_v2', {
      p_session: clashSession, p_chair: s.chairId, p_start: s.start, p_end: s.end, p_patient: patient.id,
      p_supervisor: s.supervisorId, p_delegates: [...s.placing, ...s.assisting], p_doctor: s.placingDoctorId, p_exclude: null,
    });
    if (error) return { error: userMessage(error)! };
    if (clashes?.length) return { warnings: (clashes as { message: string }[]).map((c) => c.message) };
  }

  const { data: slotId, error } = await supabase.rpc('create_surgery_slot_v3', {
    p_session: s.sessionId, p_chair: s.chairId, p_start: s.start, p_end: s.end, p_patient: patient.id,
    p_supervisor: s.supervisorId, p_placing: s.placing, p_assisting: s.assisting,
    p_implants: s.implants.map((i) => ({ tooth: i.tooth, product_id: i.productId, technique: i.technique })),
    p_override_reason: s.overrideReason, p_notes: s.notes, p_placing_doctor: s.placingDoctorId,
    p_setting: s.setting, p_date: s.date,
  });
  if (error) return { error: userMessage(error)! };
  revalidatePath('/schedule');
  revalidatePath(`/patients/${patient.id}`, 'layout');
  return { slotId: slotId as string, date: date! };
}

export async function updateBooking(input: Record<string, unknown>): Promise<BookResult> {
  const profile = await requirePermission('schedule', 'edit');
  const supabase = await createClient();
  // Read first: a clinic sends back what the booking recorded.
  const { data: slot } = await supabase
    .from('surgery_slots').select('patient_id, session_id, supervisor_id, placing_doctor_id, session:sessions(date)')
    .eq('id', typeof input.slotId === 'string' ? input.slotId : '').maybeSingle();
  if (!slot) return { error: 'Booking not found.' };
  const teaching = teachingOn(profile.features);
  const parsed = updateSlotSchema.safeParse(teaching ? forPlan(input, true) : forClinicEdit(input, slot as RecordedPeople));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const s = parsed.data;
  const recordedDate = (slot.session as unknown as { date: string } | null)?.date;
  // A clinic may move the booking to another date: it then goes to that date's clinic day.
  const moved = s.date !== null && s.date !== recordedDate;
  const date = moved ? s.date! : recordedDate;
  const clashSession = moved ? await clinicDayOn(supabase, s.date!) : (slot.session_id as string);

  if (s.overrideReason.length < 3 && clashSession) {
    const { data: clashes, error } = await supabase.rpc('slot_conflicts_v2', {
      p_session: clashSession, p_chair: s.chairId, p_start: s.start, p_end: s.end, p_patient: slot.patient_id,
      p_supervisor: s.supervisorId, p_delegates: [...s.placing, ...s.assisting], p_doctor: s.placingDoctorId, p_exclude: s.slotId,
    });
    if (error) return { error: userMessage(error)! };
    if (clashes?.length) return { warnings: (clashes as { message: string }[]).map((c) => c.message) };
  }

  // A clinic always sends the setting (null clears it) and the date; a course organizer sends neither.
  const { error } = await supabase.rpc('update_surgery_slot_v3', {
    p_slot: s.slotId, p_chair: s.chairId, p_start: s.start, p_end: s.end, p_supervisor: s.supervisorId,
    p_placing: s.placing, p_assisting: s.assisting, p_override_reason: s.overrideReason, p_notes: s.notes,
    p_placing_doctor: s.placingDoctorId, p_setting: s.setting, p_date: s.date,
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

export async function addSurgeryDay(_prev: FormState, formData: FormData): Promise<FormState> {
  const profile = await requirePermission('schedule', 'edit');
  // A clinic adds a clinic day: a surgery session with no course.
  const teaching = teachingOn(profile.features);
  const parsed = (teaching ? surgeryDaySchema : clinicDaySchema).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const d = parsed.data;
  const course = 'course_id' in d ? d.course_id : null;
  const supabase = await createClient();
  const { error } = await supabase.rpc('add_surgery_session', {
    p_course: course, p_date: d.date, p_title: d.title, p_start: d.start_time, p_end: d.end_time, p_room: d.room,
  });
  if (error) return failed(userMessage(error)!, formData);
  revalidatePath('/schedule');
  if (course) revalidatePath(`/courses/${course}`);
  return { ok: teaching ? 'Surgery day added.' : 'Clinic day added.' };
}

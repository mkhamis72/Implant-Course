import { z } from 'zod';
import { isRealDate } from '@/lib/dates';
import { isFdiTooth } from '@/lib/patients/fdi';
import { TECHNIQUES, type Technique } from '@/lib/inventory/types';
import { SESSION_TYPES, SETTINGS } from './types';
import { blankToNull, optionalUuid } from '@/lib/form-values';

const requiredId = (message: string) => z.string({ message }).uuid({ message });
const text = (max: number) => z.string().trim().max(max).default('');
const date = (message: string) => z.string().refine(isRealDate, { message });
const time = (message: string) => z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message });
const reason = (message: string) => z.string().trim().min(3, { message }).max(300);
const technique = z.enum(TECHNIQUES, { message: 'Choose Guided or Free hand for each implant.' });

export const courseSchema = z
  .object({
    name: z.string().trim().min(2, { message: 'Enter the course name (at least 2 characters).' }).max(120),
    start_date: date('Enter the start date.'),
    end_date: date('Enter the end date.'),
    venue: text(200),
    notes: text(1000),
  })
  .refine((c) => c.end_date >= c.start_date, { message: 'The course must end on or after its start date.' });

const sessionFields = {
  title: z.string().trim().min(2, { message: 'Enter the session title.' }).max(120),
  date: date('Enter the session date.'),
  start_time: time('Enter the start time (HH:MM).'),
  end_time: time('Enter the end time (HH:MM).'),
  room: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v ?? null),
    z.string().trim().max(120, { message: 'Keep the room under 120 characters.' }).nullable(),
  ),
};
const sessionEndsAfterStart = { message: 'The session must end after it starts.' };

export const sessionSchema = z
  .object({
    course_id: requiredId('Course not found.'),
    type: z.enum(SESSION_TYPES, { message: 'Choose the session type.' }),
    lead_organizer_id: optionalUuid,
    ...sessionFields,
  })
  .refine((s) => s.end_time > s.start_time, sessionEndsAfterStart);

/** "Add surgery day" on the Schedule page: always a surgery session, saved by add_surgery_session. */
export const surgeryDaySchema = z
  .object({ course_id: requiredId('Choose a course.'), ...sessionFields })
  .refine((s) => s.end_time > s.start_time, sessionEndsAfterStart);

export const chairSchema = z.object({ name: z.string().trim().min(1, { message: 'Enter the chair name.' }).max(40) });
export const supervisorSchema = z.object({
  full_name: z.string().trim().min(2, { message: 'Enter the supervisor’s name.' }).max(120, { message: 'Keep the name under 120 characters.' }),
});
export const lecturerSchema = z.object({
  full_name: z.string().trim().min(2, { message: 'Enter the lecturer’s name.' }).max(120, { message: 'Keep the name under 120 characters.' }),
});

const talkFields = {
  start: time('Enter the start time (HH:MM).'),
  end: time('Enter the end time (HH:MM).'),
  lecturer_id: requiredId('Choose a lecturer.'),
  topic: z.string().trim().min(2, { message: 'Enter a topic.' }).max(200, { message: 'Keep the topic under 200 characters.' }),
  notes: text(1000),
};
const endsAfterStart = { message: 'The end time must be after the start time.' };

export const talkSchema = z
  .object({ session_id: requiredId('Choose a session.'), ...talkFields })
  .refine((t) => t.end > t.start, endsAfterStart);

export const updateTalkSchema = z
  .object({ talk_id: requiredId('Talk not found.'), ...talkFields })
  .refine((t) => t.end > t.start, endsAfterStart);

/**
 * Who places the booked implants (0115): delegates (the default) with a required supervisor, or a doctor with no
 * placing delegates and an optional supervisor. A clinic always books a doctor; the action clears the rest there.
 */
const placedByFields = {
  placedBy: z.enum(['delegate', 'doctor']).default('delegate'),
  placingDoctorId: optionalUuid,
  supervisorId: optionalUuid,
  placing: z.array(z.string().uuid()).default([]),
  assisting: z.array(z.string().uuid()).default([]),
};
type PlacedBy = { placedBy: 'delegate' | 'doctor' | 'recorded'; placingDoctorId: string | null; supervisorId: string | null; placing: string[] };

function checkPlacedBy(p: PlacedBy, ctx: z.RefinementCtx) {
  const need = (ok: unknown, message: string) => { if (!ok) ctx.addIssue({ code: 'custom', message }); };
  if (p.placedBy === 'recorded') return;
  if (p.placedBy === 'doctor') return need(p.placingDoctorId, 'Choose the doctor.');
  need(p.supervisorId, 'Choose a supervisor.');
  need(p.placing.length > 0, 'Choose at least one placing delegate.');
}

/**
 * A clinic books by date (0122): no session, and where the surgery happens (empty = not set). A course organizer books
 * into a session and sends no date or setting. `clinic` is set only by the action, from the company's plan.
 */
const clinicFields = {
  clinic: z.boolean().default(false),
  date: z.preprocess(blankToNull, z.string().refine(isRealDate, { message: 'Choose a date.' }).nullable()),
  setting: z.preprocess(blankToNull, z.enum(SETTINGS, { message: 'Choose where the surgery happens.' }).nullable()),
};
type ByDate = { clinic: boolean; date: string | null };

function checkDate(s: ByDate, ctx: z.RefinementCtx) {
  if (s.clinic && !s.date) ctx.addIssue({ code: 'custom', message: 'Choose a date.' });
}

/** Only the chosen kind of person is sent. */
function onlyChosen<T extends PlacedBy>(p: T): T {
  if (p.placedBy === 'recorded') return { ...p, placing: [], placingDoctorId: null };
  return p.placedBy === 'doctor' ? { ...p, placing: [] } : { ...p, placingDoctorId: null };
}

/** A booking form's implant row: the tooth as typed, '' = not chosen, and its spares ('' = a spare not chosen yet, not sent). */
export type ImplantRow = { tooth: string; productId: string; technique: Technique | ''; spares: string[] };

/** Editing a booking (0126): a row already placed is sent back exactly as recorded, an empty technique included. */
export type EditImplantRow = ImplantRow & { placed: boolean };

export const MAX_SPARES = 5;

/**
 * Spares (0125): at most 5 per tooth, none repeating the planned implant or another spare; the database checks the same.
 * Checked on the item (not with `.max(5)` on the array) so the message names the tooth.
 */
function checkSpares(i: { tooth: number; productId: string | null; spares: string[] }, ctx: z.RefinementCtx) {
  const ids = i.productId ? [i.productId, ...i.spares] : i.spares;
  if (i.spares.length > MAX_SPARES) ctx.addIssue({ code: 'custom', message: `Tooth ${i.tooth} has more than ${MAX_SPARES} spares.` });
  else if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: `Tooth ${i.tooth} lists the same implant twice.` });
}

export const slotSchema = z
  .object({
    sessionId: optionalUuid,
    ...clinicFields,
    chairId: requiredId('Choose a chair.'),
    start: time('Enter the start time (HH:MM).'),
    end: time('Enter the end time (HH:MM).'),
    patientId: requiredId('Choose the patient.'),
    ...placedByFields,
    implants: z
      .array(
        z
          .object({
            tooth: z.coerce.number().refine(isFdiTooth, { message: 'Unknown tooth number.' }),
            productId: optionalUuid,
            technique,
            spares: z.array(z.string().uuid({ message: 'Choose an implant from the catalog.' })).default([]),
          })
          .superRefine(checkSpares),
      )
      .default([]),
    overrideReason: text(300),
    notes: text(1000),
  })
  .refine((s) => s.end > s.start, { message: 'The end time must be after the start time.' })
  .superRefine((s, ctx) => {
    if (!s.clinic && !s.sessionId) ctx.addIssue({ code: 'custom', message: 'Choose a surgery session.' });
    checkDate(s, ctx);
  })
  .superRefine(checkPlacedBy)
  .transform((s) => onlyChosen(s.clinic ? { ...s, sessionId: null } : { ...s, date: null, setting: null }));

/**
 * Editing a booking: `recorded` is set only by the action, in a clinic, for a booking made before the switch whose
 * delegates place the implants: they stay as recorded (update_surgery_slot_v3 keeps them, 0120) and no doctor is asked.
 */
export const updateSlotSchema = z
  .object({
    slotId: requiredId('Booking not found.'),
    chairId: requiredId('Choose a chair.'),
    start: time('Enter the start time (HH:MM).'),
    end: time('Enter the end time (HH:MM).'),
    ...placedByFields,
    placedBy: z.enum(['delegate', 'doctor', 'recorded']).default('delegate'),
    ...clinicFields,
    // The whole set (set_booking_implants, 0126). A placed tooth goes back as recorded, so it may have no technique
    // (older rows); the database refuses any change to it.
    implants: z
      .array(
        z
          .object({
            tooth: z.coerce.number().refine(isFdiTooth, { message: 'Unknown tooth number.' }),
            productId: optionalUuid,
            placed: z.boolean().default(false),
            technique: z.preprocess(blankToNull, technique.nullable()),
            spares: z.array(z.string().uuid({ message: 'Choose an implant from the catalog.' })).default([]),
          })
          .superRefine((i, ctx) => {
            if (!i.placed && !i.technique) ctx.addIssue({ code: 'custom', message: 'Choose Guided or Free hand for each implant.' });
            checkSpares(i, ctx);
          }),
      )
      .default([]),
    overrideReason: text(300),
    notes: text(1000),
  })
  .refine((s) => s.end > s.start, { message: 'The end time must be after the start time.' })
  .superRefine(checkDate)
  .superRefine(checkPlacedBy)
  .transform((s) => onlyChosen(s.clinic ? s : { ...s, date: null, setting: null }));

export const slotStatusSchema = z.object({
  slotId: requiredId('Booking not found.'),
  status: z.enum(['scheduled', 'done'], { message: 'Unknown status.' }),
});

export const cancelSlotSchema = z.object({
  slotId: requiredId('Booking not found.'),
  reason: reason('Explain why (at least 3 characters).'),
});

export const correctionSchema = z.object({
  siteId: requiredId('Implant not found.'),
  patientId: requiredId('Patient not found.'),
  componentId: optionalUuid,
  newProductId: optionalUuid,
  newLotId: optionalUuid,
  reason: reason('Explain the correction (at least 3 characters).'),
});

export const voidSchema = z.object({
  id: requiredId('Record not found.'),
  patientId: requiredId('Patient not found.'),
  reason: reason('Explain why (at least 3 characters).'),
});
export const doctorSchema = z.object({
  name: z.string().trim().min(2, { message: 'Enter the doctor’s name.' }).max(120, { message: 'Keep the name under 120 characters.' }),
});

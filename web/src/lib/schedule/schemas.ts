import { z } from 'zod';
import { isRealDate } from '@/lib/dates';
import { isFdiTooth } from '@/lib/patients/fdi';
import { SESSION_TYPES } from './types';

const blankToNull = (v: unknown) => (v === '' || v === undefined || v === null ? null : v);
const optionalId = z.preprocess(blankToNull, z.string().uuid().nullable());
const requiredId = (message: string) => z.string({ message }).uuid({ message });
const text = (max: number) => z.string().trim().max(max).default('');
const date = (message: string) => z.string().refine(isRealDate, { message });
const time = (message: string) => z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message });
const reason = (message: string) => z.string().trim().min(3, { message }).max(300);

export const courseSchema = z
  .object({
    name: z.string().trim().min(2, { message: 'Enter the course name (at least 2 characters).' }).max(120),
    start_date: date('Enter the start date.'),
    end_date: date('Enter the end date.'),
    venue: text(200),
    notes: text(1000),
  })
  .refine((c) => c.end_date >= c.start_date, { message: 'The course must end on or after its start date.' });

export const sessionSchema = z
  .object({
    course_id: requiredId('Course not found.'),
    type: z.enum(SESSION_TYPES, { message: 'Choose the session type.' }),
    title: z.string().trim().min(2, { message: 'Enter the session title.' }).max(120),
    date: date('Enter the session date.'),
    start_time: time('Enter the start time (HH:MM).'),
    end_time: time('Enter the end time (HH:MM).'),
    lead_organizer_id: optionalId,
  })
  .refine((s) => s.end_time > s.start_time, { message: 'The session must end after it starts.' });

export const chairSchema = z.object({ name: z.string().trim().min(1, { message: 'Enter the chair name.' }).max(40) });
export const supervisorSchema = z.object({
  full_name: z.string().trim().min(2, { message: 'Enter the supervisor’s name.' }).max(120, { message: 'Keep the name under 120 characters.' }),
});

export const slotSchema = z
  .object({
    sessionId: requiredId('Choose a surgery session.'),
    chairId: requiredId('Choose a chair.'),
    start: time('Enter the start time (HH:MM).'),
    end: time('Enter the end time (HH:MM).'),
    patientFileNo: z.string().trim().min(1, { message: 'Choose the patient.' }),
    supervisorId: requiredId('Choose the supervising organizer.'),
    placing: z.array(z.string().uuid()).min(1, { message: 'Choose at least one placing delegate.' }),
    assisting: z.array(z.string().uuid()).default([]),
    implants: z
      .array(
        z.object({
          tooth: z.coerce.number().refine(isFdiTooth, { message: 'Unknown tooth number.' }),
          productId: optionalId,
        }),
      )
      .default([]),
    overrideReason: text(300),
    notes: text(1000),
  })
  .refine((s) => s.end > s.start, { message: 'The end time must be after the start time.' });

export const cancelSlotSchema = z.object({
  slotId: requiredId('Booking not found.'),
  reason: reason('Explain why (at least 3 characters).'),
});

export const correctionSchema = z.object({
  siteId: requiredId('Implant not found.'),
  patientId: requiredId('Patient not found.'),
  componentId: optionalId,
  newProductId: optionalId,
  newLotId: requiredId('Choose the correct batch.'),
  reason: reason('Explain the correction (at least 3 characters).'),
});

export const voidSchema = z.object({
  id: requiredId('Record not found.'),
  patientId: requiredId('Patient not found.'),
  reason: reason('Explain why (at least 3 characters).'),
});

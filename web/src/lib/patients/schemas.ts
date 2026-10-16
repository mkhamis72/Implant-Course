import { z } from 'zod';
import { isRealDate, todayIso } from '@/lib/dates';
import { isFdiTooth, parseTeeth } from './fdi';
import { SMOKING, YES_NO } from './risk-factors';
import { MANUAL_STATES } from './types';

const text = (max: number) => z.string().trim().max(max).default('');

export const patientSchema = z.object({
  full_name: z.string().trim().min(2, { message: 'Enter the patient’s full name (at least 2 characters).' }).max(120),
  file_no: z.string().trim().max(30, { message: 'File number is too long (max 30 characters).' }).default(''),
  dob: z
    .string()
    .trim()
    .default('')
    .refine((v) => v === '' || (isRealDate(v) && v >= '1900-01-01' && v <= todayIso()), {
      message: 'Enter a real date of birth (not in the future, after 1900).',
    }),
  sex: z.enum(['', 'female', 'male']).default(''),
  phone: text(40),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .default('')
    .refine((v) => v === '' || z.string().email().safeParse(v).success, {
      message: 'Enter a valid email address or leave it empty.',
    }),
  address: text(300),
});

export type PatientInput = z.infer<typeof patientSchema>;

/** Row for insert/update. An empty file number is left out so the database assigns/keeps one. */
export function toPatientRow(p: PatientInput): Record<string, string | null> {
  const row: Record<string, string | null> = {
    full_name: p.full_name,
    dob: p.dob || null,
    sex: p.sex || null,
    phone: p.phone,
    email: p.email,
    address: p.address,
  };
  if (p.file_no) row.file_no = p.file_no;
  return row;
}

const blankToNull = (v: unknown) => (v === '' || v === undefined || v === null ? null : v);
const yesNo = z.preprocess(blankToNull, z.enum(YES_NO, { message: 'Choose yes, no or not assessed.' }).nullable());
const number = (message: string, check: (n: number) => boolean) =>
  z.preprocess((v) => (blankToNull(v) === null ? null : Number(v)), z.number({ message }).refine(check, { message }).nullable());

export const medicalHistorySchema = z
  .object({
    allergies: text(1000),
    medications: text(1000),
    smoking: z.preprocess(blankToNull, z.enum(SMOKING, { message: 'Choose never, former, current or not assessed.' }).nullable()),
    cigarettes_per_day: number('Enter cigarettes per day as a whole number from 1 to 100.', (n) => Number.isInteger(n) && n >= 1 && n <= 100),
    diabetes_status: yesNo,
    hba1c: number('Enter an HbA1c between 4 and 20 %.', (n) => n >= 4 && n <= 20),
    hba1c_date: z.preprocess(
      blankToNull,
      z.string().refine((v) => isRealDate(v) && v <= todayIso(), { message: 'Enter the HbA1c date (today or earlier).' }).nullable(),
    ),
    bisphosphonates_status: yesNo,
    anticoagulants_status: yesNo,
    radiotherapy_status: yesNo,
    osteoporosis_status: yesNo,
    periodontitis_history: yesNo,
    bruxism: yesNo,
    previous_implant_failure: yesNo,
    other_conditions: text(1000),
    notes: text(2000),
  })
  .superRefine((h, ctx) => {
    if (h.cigarettes_per_day !== null && h.smoking !== 'current') {
      ctx.addIssue({ code: 'custom', path: ['cigarettes_per_day'], message: 'Cigarettes per day only applies to a current smoker.' });
    }
    if ((h.hba1c === null) !== (h.hba1c_date === null)) {
      ctx.addIssue({ code: 'custom', path: ['hba1c'], message: 'Enter the HbA1c value and the date it was measured.' });
    }
  });

export const noteSchema = z.object({
  visit_date: z.string().refine((v) => isRealDate(v) && v <= todayIso(), {
    message: 'Enter the visit date (today or earlier).',
  }),
  text: z.string().trim().min(1, { message: 'Write the note.' }).max(5000, { message: 'The note is too long (max 5000 characters).' }),
  teeth: z
    .string()
    .default('')
    .transform((v, ctx) => {
      const result = parseTeeth(v);
      if ('error' in result) {
        ctx.addIssue({ code: 'custom', message: result.error });
        return z.NEVER;
      }
      return result.teeth;
    }),
});

export const toothStatusSchema = z.object({
  patient_id: z.string().uuid(),
  teeth: z
    .array(z.number().refine(isFdiTooth, { message: 'Unknown tooth number.' }))
    .min(1, { message: 'Select at least one tooth.' }),
  status: z.enum(MANUAL_STATES),
});

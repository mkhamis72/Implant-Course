import { z } from 'zod';
import { isFdiTooth, parseTeeth } from './fdi';
import { MANUAL_STATES } from './types';
import { APP_TIME_ZONE } from '@/lib/format';

const text = (max: number) => z.string().trim().max(max).default('');

function isRealDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Today's date in the clinic's time zone (en-CA formats as YYYY-MM-DD). */
function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE }).format(new Date());
}

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

const checkbox = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());

export const medicalHistorySchema = z.object({
  allergies: text(1000),
  medications: text(1000),
  diabetes: checkbox,
  smoker: checkbox,
  bisphosphonates: checkbox,
  anticoagulants: checkbox,
  radiotherapy_head_neck: checkbox,
  osteoporosis: checkbox,
  other_conditions: text(1000),
  notes: text(2000),
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

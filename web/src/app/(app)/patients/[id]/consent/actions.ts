'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { userMessage } from '@/lib/db-errors';
import { encodeBytea } from '@/lib/branding/image';
import { consentFileProblem, sniffConsentFile } from '@/lib/consent/files';
import { CONSENT_LANGUAGES } from '@/lib/consent/labels';

type Result = { error?: string };

const answer = z.enum(['yes', 'no'], { error: 'Answer all four items (yes or no).' });
const recordSchema = z.object({
  version: z.string({ error: 'Choose the form version that was signed.' }).uuid('Choose the form version that was signed.'),
  language: z.enum(CONSENT_LANGUAGES, { error: 'Choose the language of the signed form.' }),
  signed_on: z.string({ error: 'Enter the date the form was signed.' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date the form was signed.'),
  treatment: answer,
  research: answer,
  teaching_images: answer,
  follow_up: answer,
});

function done(patientId: string): Result {
  revalidatePath(`/patients/${patientId}`, 'layout');
  revalidatePath(`/patients/${patientId}/consent`);
  return {};
}

/** Records a signed consent form with its scan (a JPEG photo, already downscaled in the browser, or a PDF). */
export async function recordConsent(patientId: string, formData: FormData): Promise<Result> {
  await requirePermission('patients', 'edit');
  const parsed = recordSchema.safeParse({
    version: formData.get('version') ?? undefined, language: formData.get('language') ?? undefined,
    signed_on: formData.get('signed_on') ?? undefined, treatment: formData.get('treatment') ?? undefined,
    research: formData.get('research') ?? undefined, teaching_images: formData.get('teaching_images') ?? undefined,
    follow_up: formData.get('follow_up') ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;

  const file = formData.get('file');
  if (!(file instanceof Blob) || file.size === 0) return { error: 'Upload the signed form.' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const problem = consentFileProblem(bytes);
  if (problem) return { error: problem };

  const supabase = await createClient();
  const { error } = await supabase.rpc('record_consent', {
    p_patient: patientId, p_version: v.version, p_language: v.language, p_signed_on: v.signed_on,
    p_treatment: v.treatment === 'yes', p_research: v.research === 'yes',
    p_teaching_images: v.teaching_images === 'yes', p_follow_up: v.follow_up === 'yes',
    p_file: encodeBytea(bytes), p_content_type: sniffConsentFile(bytes)!,
  });
  if (error) return { error: userMessage(error)! };
  return done(patientId);
}

export async function voidConsent(patientId: string, id: string, reason: string): Promise<Result> {
  await requirePermission('patients', 'edit');
  const supabase = await createClient();
  const { error } = await supabase.rpc('void_consent', { p_id: id, p_reason: reason });
  if (error) return { error: userMessage(error)! };
  return done(patientId);
}

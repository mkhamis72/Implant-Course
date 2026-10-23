'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { isRealDate } from '@/lib/dates';
import { failed, type FormState } from '@/lib/patients/form-state';
import { userMessage } from '@/lib/db-errors';

const versionSchema = z.object({
  id: z.union([z.literal(''), z.string().uuid()]).optional(),
  label: z.string().trim().min(1, 'Enter a label for the form version (up to 20 characters).')
    .max(20, 'Enter a label for the form version (up to 20 characters).'),
  effective_on: z.string().refine(isRealDate, 'Enter the date this version takes effect.'),
  text_en: z.string().trim().min(1, 'Enter the English and Arabic text of the form.'),
  text_ar: z.string().trim().min(1, 'Enter the English and Arabic text of the form.'),
});

/** Adds a consent form version (no id) or edits one patients haven't signed yet; the database decides the lock. */
export async function saveConsentVersion(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const field = (k: string) => (typeof formData.get(k) === 'string' ? (formData.get(k) as string) : '');
  const parsed = versionSchema.safeParse({
    id: field('id'), label: field('label'), effective_on: field('effective_on'), text_en: field('text_en'), text_ar: field('text_ar'),
  });
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('save_consent_version', {
    p_id: v.id || null, p_label: v.label, p_effective_on: v.effective_on, p_text_en: v.text_en, p_text_ar: v.text_ar,
  });
  if (error) return failed(userMessage(error) ?? 'Could not save the form version.', formData);
  revalidatePath('/admin/settings/consent');
  return { ok: v.id ? 'Form version saved.' : 'Form version added.' };
}

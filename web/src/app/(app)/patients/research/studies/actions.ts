'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin, requirePermission } from '@/lib/auth/session';
import { userMessage } from '@/lib/db-errors';
import { encodeBytea } from '@/lib/branding/image';
import { consentFileProblem, sniffConsentFile } from '@/lib/consent/files';

type Result = { error?: string };

const text = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

function done(): Result {
  revalidatePath('/patients/research/studies');
  revalidatePath('/patients/research');
  return {};
}

/**
 * Adds (id null) or edits a study and its courses; then sets the approval letter (a JPEG photo, already downscaled
 * in the browser, or a PDF) or removes it when `remove_letter` is ticked. The rules live in save_study (0073).
 */
export async function saveStudy(id: string | null, formData: FormData): Promise<Result> {
  await requirePermission('research', 'edit');
  const title = text(formData, 'title');
  if (!title) return { error: 'Enter the study title.' };

  // The letter is checked before anything is saved, so a refused file leaves the study as it was.
  const file = formData.get('letter');
  let letter: Uint8Array | null = null;
  if (file instanceof Blob && file.size > 0) {
    letter = new Uint8Array(await file.arrayBuffer());
    const problem = consentFileProblem(letter);
    if (problem) return { error: problem };
  }

  const supabase = await createClient();
  const courses = formData.getAll('courses').filter((c): c is string => typeof c === 'string' && c !== '');
  const { data: studyId, error } = await supabase.rpc('save_study', {
    p_id: id, p_title: title, p_committee: text(formData, 'committee'),
    p_approval_number: text(formData, 'approval_number'), p_approval_date: text(formData, 'approval_date'),
    p_protocol_name: text(formData, 'protocol_name'), p_protocol_version: text(formData, 'protocol_version'),
    p_protocol_date: text(formData, 'protocol_date'), p_notes: text(formData, 'notes'), p_courses: courses,
  });
  if (error) return { error: userMessage(error)! };

  if (letter) {
    const { error: e } = await supabase.rpc('set_study_letter', {
      p_study: studyId as string, p_file: encodeBytea(letter), p_content_type: sniffConsentFile(letter)!,
    });
    if (e) {
      done();
      return { error: `The study was saved, but not the letter: ${userMessage(e)}` };
    }
  } else if (id && formData.get('remove_letter') === 'on') {
    const { error: e } = await supabase.rpc('clear_study_letter', { p_study: id });
    if (e) {
      done();
      return { error: `The study was saved, but the letter wasn't removed: ${userMessage(e)}` };
    }
  }
  return done();
}

/** Admin only; delete_study refuses a study named on an export. */
export async function deleteStudy(id: string): Promise<Result> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc('delete_study', { p_id: id });
  if (error) return { error: userMessage(error)! };
  return done();
}

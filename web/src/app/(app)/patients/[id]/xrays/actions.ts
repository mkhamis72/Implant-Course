'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { userMessage } from '@/lib/db-errors';
import { radiographSchema } from '@/lib/radiographs/radiographs';

type Result = { error?: string };

async function run(patientId: string, fn: string, args: Record<string, unknown>): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: userMessage(error)! };
  revalidatePath(`/patients/${patientId}`, 'layout');
  revalidatePath(`/patients/${patientId}/xrays`);
  return {};
}

export async function saveRadiograph(input: Record<string, unknown>): Promise<Result> {
  await requirePermission('patients', 'edit');
  const parsed = radiographSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  return run(v.patientId, 'save_radiograph', {
    p_id: v.id, p_patient: v.patientId, p_taken_on: v.takenOn, p_type: v.type, p_purpose: v.purpose, p_teeth: v.teeth,
    p_link: v.link, p_notes: v.notes, p_levels: v.levels, p_expected_updated_at: v.expectedUpdatedAt,
  });
}

export async function voidRadiograph(input: { patientId: string; id: string; reason: string }): Promise<Result> {
  await requirePermission('patients', 'edit');
  return run(input.patientId, 'void_radiograph', { p_id: input.id, p_reason: input.reason });
}

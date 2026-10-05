'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { toothStatusSchema } from '@/lib/patients/schemas';
import { canSetByHand } from '@/lib/patients/types';

export async function setToothStatus(input: { patientId: string; teeth: number[]; status: string }): Promise<{ error?: string }> {
  await requirePermission('patients', 'edit');
  const parsed = toothStatusSchema.safeParse({ patient_id: input.patientId, teeth: input.teeth, status: input.status });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { patient_id, teeth, status } = parsed.data;

  const supabase = await createClient();
  const { data: current, error: readError } = await supabase
    .from('tooth_status')
    .select('tooth, status')
    .eq('patient_id', patient_id)
    .in('tooth', teeth);
  if (readError) return { error: 'The chart could not be loaded. Please try again.' };

  const currentByTooth = new Map((current ?? []).map((row) => [row.tooth as number, row.status as string]));
  const locked = teeth.filter((t) => !canSetByHand(currentByTooth.get(t) ?? 'present'));
  if (locked.length) return { error: `Teeth ${locked.join(', ')} have implant records and can't be changed here.` };

  const rows = teeth
    .filter((t) => (currentByTooth.get(t) ?? 'present') !== status)
    .map((tooth) => ({ patient_id, tooth, status }));
  if (rows.length === 0) return {};

  const { data, error } = await supabase.from('tooth_status').upsert(rows, { onConflict: 'patient_id,tooth' }).select('tooth');
  if (error || (data?.length ?? 0) !== rows.length) {
    console.error('Tooth status save failed:', error?.message ?? 'row count mismatch');
    return { error: 'The chart could not be saved. Please try again.' };
  }
  revalidatePath(`/patients/${patient_id}`);
  return {};
}

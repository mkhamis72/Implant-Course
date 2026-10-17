'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { userMessage } from '@/lib/db-errors';
import { complicationSchema, toDetails } from '@/lib/implants/complications';
import { failureSchema } from '@/lib/implants/failure';

type Result = { error?: string };

async function run(patientId: string, fn: string, args: Record<string, unknown>): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: userMessage(error)! };
  revalidatePath(`/patients/${patientId}`, 'layout');
  return {};
}

export async function saveComplication(input: Record<string, unknown>): Promise<Result> {
  await requirePermission('patients', 'edit');
  const parsed = complicationSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  return v.complicationId
    ? run(v.patientId, 'update_complication', { p_complication: v.complicationId, p_details: toDetails(v), p_expected_updated_at: v.expectedUpdatedAt })
    : run(v.patientId, 'record_complication', { p_site: v.siteId, p_details: toDetails(v) });
}

export async function voidComplication(input: { patientId: string; complicationId: string; reason: string }): Promise<Result> {
  await requirePermission('patients', 'edit');
  return run(input.patientId, 'void_complication', { p_complication: input.complicationId, p_reason: input.reason });
}

export async function saveFailure(input: Record<string, unknown>): Promise<Result> {
  await requirePermission('patients', 'edit');
  const parsed = failureSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const f = parsed.data;
  const fields = { p_site: f.siteId, p_failed_on: f.failedOn, p_type: f.failureType, p_reason: f.failureReason, p_notes: f.failureNotes };
  return f.expectedUpdatedAt
    ? run(f.patientId, 'correct_failure', { ...fields, p_expected_updated_at: f.expectedUpdatedAt })
    : run(f.patientId, 'record_failure', fields);
}

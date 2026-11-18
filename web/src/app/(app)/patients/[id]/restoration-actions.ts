'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { userMessage } from '@/lib/db-errors';
import { teachingOn } from '@/lib/modules/modules';
import { problemEditSchema, problemSchema, restorationEditSchema, restorationSchema } from '@/lib/restorations/restorations';

type Result = { error?: string };

async function run(patientId: string, fn: string, args: Record<string, unknown>): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: userMessage(error)! };
  revalidatePath(`/patients/${patientId}`, 'layout');
  return {};
}

export async function addRestoration(input: Record<string, unknown>): Promise<Result> {
  await requirePermission('patients', 'edit');
  const parsed = restorationSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  return run(v.patientId, 'add_restoration', {
    p_patient: v.patientId, p_stage: v.stage, p_type: v.type, p_sites: v.sites, p_teeth: v.teeth, p_fitted_on: v.fittedOn,
    p_retention: v.retention, p_material: v.material, p_delegate: v.delegateId, p_supervisor: v.supervisorId, p_course: v.courseId,
    p_remake_reason: v.remakeReason, p_notes: v.notes,
  });
}

export async function updateRestoration(input: Record<string, unknown>): Promise<Result> {
  const profile = await requirePermission('patients', 'edit');
  const parsed = restorationEditSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  let people = { delegate: v.delegateId, supervisor: v.supervisorId, course: v.courseId };
  if (!teachingOn(profile.features)) {
    // A clinic doesn't see what an older restoration names (before the switch), so it goes back as recorded,
    // whatever the client sent: update_restoration refuses any change to it (0119).
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('restorations')
      .select('delegate_id, supervisor_id, course_id')
      .eq('id', v.restorationId)
      .maybeSingle();
    if (error || !data) return { error: 'Restoration not found.' };
    people = { delegate: data.delegate_id, supervisor: data.supervisor_id, course: data.course_id };
  }
  return run(v.patientId, 'update_restoration', {
    p_restoration: v.restorationId, p_retention: v.retention, p_material: v.material, p_delegate: people.delegate,
    p_supervisor: people.supervisor, p_course: people.course, p_notes: v.notes, p_expected_updated_at: v.expectedUpdatedAt,
  });
}

export async function voidRestoration(input: { patientId: string; restorationId: string; reason: string }): Promise<Result> {
  await requirePermission('patients', 'edit');
  return run(input.patientId, 'void_restoration', { p_restoration: input.restorationId, p_reason: input.reason });
}

export async function recordRestorationProblem(input: Record<string, unknown>): Promise<Result> {
  await requirePermission('patients', 'edit');
  const parsed = problemSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  return run(v.patientId, 'record_restoration_problem', {
    p_restoration: v.restorationId, p_noticed_on: v.noticedOn, p_type: v.type, p_action: v.action, p_notes: v.notes,
  });
}

export async function updateRestorationProblem(input: Record<string, unknown>): Promise<Result> {
  await requirePermission('patients', 'edit');
  const parsed = problemEditSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  return run(v.patientId, 'update_restoration_problem', {
    p_problem: v.problemId, p_noticed_on: v.noticedOn, p_type: v.type, p_action: v.action, p_notes: v.notes,
    p_expected_updated_at: v.expectedUpdatedAt,
  });
}

export async function voidRestorationProblem(input: { patientId: string; problemId: string; reason: string }): Promise<Result> {
  await requirePermission('patients', 'edit');
  return run(input.patientId, 'void_restoration_problem', { p_problem: input.problemId, p_reason: input.reason });
}

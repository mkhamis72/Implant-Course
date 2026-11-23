'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { userMessage } from '@/lib/db-errors';
import {
  caseEditSchema, caseRestorationSchema, caseSchema, caseSitesSchema, caseStageSchema, clearStageSchema, closeCaseSchema,
  reopenCaseSchema,
} from '@/lib/full-arch/cases';

type Result = { error?: string };

async function run(patientId: string, fn: string, args: Record<string, unknown>): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: userMessage(error)! };
  revalidatePath(`/patients/${patientId}`, 'layout');
  return {};
}

export async function createCase(input: Record<string, unknown>): Promise<Result> {
  await requirePermission('patients', 'edit');
  const parsed = caseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  return run(v.patientId, 'create_full_arch_case', {
    p_patient: v.patientId, p_arch: v.arch, p_configuration: v.configuration, p_name: v.name, p_notes: v.notes, p_sites: v.sites,
  });
}

export async function updateCase(input: Record<string, unknown>): Promise<Result> {
  await requirePermission('patients', 'edit');
  const parsed = caseEditSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  return run(v.patientId, 'update_full_arch_case', {
    p_case: v.caseId, p_configuration: v.configuration, p_name: v.name, p_notes: v.notes, p_updated_at: v.expectedUpdatedAt,
  });
}

export async function setCaseSites(input: Record<string, unknown>): Promise<Result> {
  await requirePermission('patients', 'edit');
  const parsed = caseSitesSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  return run(v.patientId, 'set_case_sites', { p_case: v.caseId, p_sites: v.sites, p_updated_at: v.expectedUpdatedAt });
}

/** caseId empty unlinks the restoration. */
export async function setCaseRestoration(input: Record<string, unknown>): Promise<Result> {
  await requirePermission('patients', 'edit');
  const parsed = caseRestorationSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  return run(v.patientId, 'set_case_restoration', { p_restoration: v.restorationId, p_case: v.caseId });
}

export async function recordCaseStage(input: Record<string, unknown>): Promise<Result> {
  await requirePermission('patients', 'edit');
  const parsed = caseStageSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  return run(v.patientId, 'record_case_stage', {
    p_case: v.caseId, p_stage: v.stage, p_done_on: v.doneOn, p_lab: v.lab, p_passive_fit: v.passiveFit,
    p_occlusion: v.occlusion, p_notes: v.notes,
  });
}

export async function clearCaseStage(input: Record<string, unknown>): Promise<Result> {
  await requirePermission('patients', 'edit');
  const parsed = clearStageSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  return run(v.patientId, 'clear_case_stage', { p_case: v.caseId, p_stage: v.stage });
}

export async function closeCase(input: Record<string, unknown>): Promise<Result> {
  await requirePermission('patients', 'edit');
  const parsed = closeCaseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  return run(v.patientId, 'close_full_arch_case', { p_case: v.caseId, p_reason: v.reason, p_updated_at: v.expectedUpdatedAt });
}

export async function reopenCase(input: Record<string, unknown>): Promise<Result> {
  await requirePermission('patients', 'edit');
  const parsed = reopenCaseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  return run(v.patientId, 'reopen_full_arch_case', { p_case: v.caseId, p_updated_at: v.expectedUpdatedAt });
}

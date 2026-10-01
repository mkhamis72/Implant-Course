'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireActiveUser } from '@/lib/auth/session';
import { componentSchema, followupSchema, placeSchema, planSchema } from '@/lib/inventory/schemas';
import { userMessage } from '@/lib/db-errors';

type Result = { error?: string };

async function run(patientId: string, fn: string, args: Record<string, unknown>): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: userMessage(error)! };
  revalidatePath(`/patients/${patientId}`, 'layout');
  return {};
}

export async function planImplant(input: Record<string, unknown>): Promise<Result> {
  await requireActiveUser();
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const p = parsed.data;
  return run(p.patientId, 'plan_implant', { p_patient: p.patientId, p_tooth: p.tooth, p_product: p.productId, p_notes: p.notes });
}

export async function cancelPlan(input: { patientId: string; siteId: string }): Promise<Result> {
  await requireActiveUser();
  return run(input.patientId, 'cancel_planned_implant', { p_site: input.siteId });
}

export async function placeImplant(input: Record<string, unknown>): Promise<Result> {
  await requireActiveUser();
  const parsed = placeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const p = parsed.data;
  return run(p.patientId, 'place_implant', {
    p_patient: p.patientId,
    p_tooth: p.tooth,
    p_product: p.productId,
    p_lot: p.lotId,
    p_placed_on: p.placedOn,
    p_placing_delegate: p.placingDelegateId,
    p_supervisor: p.supervisorId,
    p_assisting_delegate: p.assistingDelegateId,
    p_torque: p.torque,
    p_graft: p.graft,
    p_notes: p.notes,
    p_slot: p.slotId,
  });
}

export async function fitComponent(input: Record<string, unknown>): Promise<Result> {
  await requireActiveUser();
  const parsed = componentSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const c = parsed.data;
  return run(c.patientId, 'fit_component', {
    p_site: c.siteId,
    p_type: c.componentType,
    p_fitted_on: c.fittedOn,
    p_product: c.productId,
    p_lot: c.lotId,
    p_by_delegate: c.byDelegateId,
    p_by_organizer: c.byOrganizerId,
    p_notes: c.notes,
  });
}

export async function recordFollowup(input: Record<string, unknown>): Promise<Result> {
  await requireActiveUser();
  const parsed = followupSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const f = parsed.data;
  return run(f.patientId, 'record_followup', {
    p_site: f.siteId,
    p_date: f.date,
    p_check_type: f.checkType,
    p_outcome: f.outcome,
    p_notes: f.notes,
  });
}

'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { componentSchema, correctPlacementSchema, placeSchema, planSchema, receiveSchema } from '@/lib/inventory/schemas';
import { TECHNIQUES, type Technique } from '@/lib/inventory/types';
import { userMessage } from '@/lib/db-errors';
import { correctionSchema, voidSchema } from '@/lib/schedule/schemas';

type Result = { error?: string };

async function run(patientId: string, fn: string, args: Record<string, unknown>): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: userMessage(error)! };
  revalidatePath(`/patients/${patientId}`, 'layout');
  return {};
}

export async function planImplant(input: Record<string, unknown>): Promise<Result> {
  await requirePermission('patients', 'edit');
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const p = parsed.data;
  return run(p.patientId, 'plan_implant', { p_patient: p.patientId, p_tooth: p.tooth, p_product: p.productId, p_notes: p.notes, p_technique: p.technique });
}

export async function cancelPlan(input: { patientId: string; siteId: string }): Promise<Result> {
  await requirePermission('patients', 'edit');
  return run(input.patientId, 'cancel_planned_implant', { p_site: input.siteId });
}

export async function placeImplant(input: Record<string, unknown>): Promise<Result> {
  await requirePermission('patients', 'edit');
  const parsed = placeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const p = parsed.data;
  return run(p.patientId, 'place_implant_v2', {
    p_patient: p.patientId,
    p_tooth: p.tooth,
    p_product: p.productId,
    p_lot: p.lotId,
    p_placed_on: p.placedOn,
    p_placing_delegate: p.placingDelegateId,
    p_supervisor: p.supervisorId,
    p_assisting_delegate: p.assistingDelegateId,
    p_torque: null,
    p_isq: null,
    p_bone_type: null,
    p_graft: p.graft,
    p_notes: p.notes,
    p_slot: p.slotId,
    p_technique: p.technique,
  });
}

/**
 * Receives stock from inside the placement form, so nothing typed there is lost: no redirect (unlike
 * Inventory → Receive), the chart refreshes and the form selects the returned batch.
 */
export async function receiveStockForPlacement(patientId: string, input: Record<string, unknown>): Promise<Result & { lotId?: string }> {
  await requirePermission('inventory', 'edit');
  const parsed = receiveSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const r = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('receive_stock', {
    p_product: r.product_id, p_qty: r.quantity, p_lot_no: r.lot_no || null, p_expiry: r.expiry, p_received_on: r.received_on, p_notes: r.notes,
  });
  if (error) return { error: userMessage(error)! };
  revalidatePath(`/patients/${patientId}`, 'layout');
  return { lotId: data as string };
}

export async function setTechnique(input: { patientId: string; siteId: string; technique: string }): Promise<Result> {
  await requirePermission('patients', 'edit');
  if (!(TECHNIQUES as readonly string[]).includes(input.technique)) return { error: 'Choose Guided or Free hand.' };
  return run(input.patientId, 'set_implant_technique', { p_site: input.siteId, p_technique: input.technique as Technique });
}

export async function fitComponent(input: Record<string, unknown>): Promise<Result> {
  await requirePermission('patients', 'edit');
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

export async function correctPlacement(input: Record<string, unknown>): Promise<Result> {
  await requirePermission('patients', 'edit');
  const parsed = correctPlacementSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const p = parsed.data;
  return run(p.patientId, 'correct_placement', {
    p_site: p.siteId,
    p_placed_on: p.placedOn,
    p_placing_delegate: p.placingDelegateId,
    p_assisting_delegate: p.assistingDelegateId,
    p_supervisor: p.supervisorId,
    p_torque: null,
    p_isq: null,
    p_bone_type: null,
    p_graft: p.graft,
    p_notes: p.notes,
  });
}

export async function correctBatch(input: Record<string, unknown>): Promise<Result> {
  await requirePermission('patients', 'edit');
  const parsed = correctionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const c = parsed.data;
  return run(c.patientId, 'correct_batch', {
    p_site: c.siteId, p_new_lot: c.newLotId, p_reason: c.reason, p_component: c.componentId, p_new_product: c.newProductId,
  });
}

export async function voidFollowup(input: Record<string, unknown>): Promise<Result> {
  await requirePermission('patients', 'edit');
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  return run(parsed.data.patientId, 'void_followup', { p_followup: parsed.data.id, p_reason: parsed.data.reason });
}

export async function voidComponent(input: Record<string, unknown>): Promise<Result> {
  await requirePermission('patients', 'edit');
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  return run(parsed.data.patientId, 'void_component', { p_component: parsed.data.id, p_reason: parsed.data.reason });
}

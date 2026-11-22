'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { userMessage } from '@/lib/db-errors';
import { graftSchema, surgerySchema } from '@/lib/implants/surgery';
import { geometrySchema } from '@/lib/inventory/schemas';

type Result = { error?: string };

async function run(patientId: string, fn: string, args: Record<string, unknown>): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: userMessage(error)! };
  revalidatePath(`/patients/${patientId}`, 'layout');
  return {};
}

export async function saveSurgery(input: Record<string, unknown>): Promise<Result> {
  await requirePermission('patients', 'edit');
  const parsed = surgerySchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const s = parsed.data;
  return run(s.patientId, 'save_implant_surgery_v2', {
    p_site: s.siteId,
    p_extraction_date: s.extractionDate,
    p_placement_timing: s.placementTiming,
    p_soft_tissue_phenotype: s.softTissuePhenotype,
    p_keratinized_mucosa_mm: s.keratinizedMucosaMm,
    p_flap: s.flap,
    p_torque_type: s.torqueType,
    p_healing: s.healing,
    p_primary_closure: s.primaryClosure,
    p_grafting_performed: s.graftingPerformed,
    p_torque: s.torque,
    p_isq: s.isq,
    p_bone_type: s.boneType,
    p_expected_updated_at: s.expectedUpdatedAt,
  });
}

/** The type and angle section of Surgical details, saved as a whole (set_implant_geometry, 0140). */
export async function saveImplantGeometry(input: Record<string, unknown>): Promise<Result> {
  await requirePermission('patients', 'edit');
  const parsed = geometrySchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const g = parsed.data;
  return run(g.patientId, 'set_implant_geometry', {
    p_site: g.siteId, p_type: g.type, p_angulation: g.angulation, p_direction: g.direction, p_anchorage: g.anchorage,
    p_entry: g.entryPoint, p_trajectory: g.trajectory,
  });
}

export async function saveGraft(input: Record<string, unknown>): Promise<Result> {
  await requirePermission('patients', 'edit');
  const parsed = graftSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const g = parsed.data;
  const fields = {
    p_procedure: g.procedure, p_timing: g.timing, p_performed_on: g.performedOn, p_material: g.material,
    p_product: g.product, p_membrane: g.membrane, p_notes: g.notes,
  };
  return g.graftId
    ? run(g.patientId, 'update_implant_graft', { p_graft: g.graftId, ...fields })
    : run(g.patientId, 'add_implant_graft', { p_site: g.siteId, ...fields });
}

export async function deleteGraft(input: { patientId: string; graftId: string }): Promise<Result> {
  await requirePermission('patients', 'edit');
  return run(input.patientId, 'delete_implant_graft', { p_graft: input.graftId });
}

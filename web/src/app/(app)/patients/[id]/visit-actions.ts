'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { userMessage } from '@/lib/db-errors';
import { toFindings, visitSchema } from '@/lib/visits/visits';

export async function recordVisit(input: Record<string, unknown>): Promise<{ error?: string }> {
  await requirePermission('patients', 'edit');
  const parsed = visitSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('record_visit', {
    p_site: v.siteId,
    p_date: v.date,
    p_visit_key: v.visitKey,
    p_check_type: v.checkType,
    p_attendance: v.attendance,
    p_outcome: v.outcome,
    p_findings: toFindings(v),
    p_notes: v.notes,
  });
  if (error) return { error: userMessage(error)! };
  revalidatePath(`/patients/${v.patientId}`, 'layout');
  return {};
}

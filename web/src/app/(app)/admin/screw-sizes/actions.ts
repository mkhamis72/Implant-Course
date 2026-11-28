'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { screwSizeSchema } from '@/lib/admin/screw-sizes';
import { failed, type FormState } from '@/lib/patients/form-state';
import { userMessage } from '@/lib/db-errors';

/** Adds a size (no id) or edits one (id), through save_screw_size. */
export async function saveScrewSize(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = screwSizeSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('save_screw_size', {
    p_id: v.id || null,
    p_brand: v.brand,
    p_system: v.system,
    p_kind: v.kind,
    p_label: v.label,
    p_driver_interface: v.driver_interface,
    p_driver_size: v.driver_size,
    p_driver_ref: v.driver_ref,
    p_torque: v.torque,
  });
  if (error) return failed(userMessage(error)!, formData);
  revalidatePath('/admin/screw-sizes');
  return { ok: v.id ? 'Saved.' : 'Screw size added.' };
}

/** Switches a size off or on; the row stays. */
export async function setScrewSizeActive(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = z
    .object({ id: z.string().uuid(), active: z.enum(['true', 'false']) })
    .safeParse({ id: formData.get('id'), active: formData.get('active') });
  if (!parsed.success) return { error: 'Invalid request.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_screw_size_active', { p_id: parsed.data.id, p_active: parsed.data.active === 'true' });
  if (error) return { error: userMessage(error)! };
  revalidatePath('/admin/screw-sizes');
  return { ok: parsed.data.active === 'true' ? 'Switched on.' : 'Switched off.' };
}

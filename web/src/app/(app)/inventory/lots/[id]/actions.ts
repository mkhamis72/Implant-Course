'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { adjustSchema } from '@/lib/inventory/schemas';
import { failed, type FormState } from '@/lib/patients/form-state';
import { userMessage } from '@/lib/db-errors';

export async function adjustStock(_prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission('inventory', 'edit');
  const parsed = adjustSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const a = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc('adjust_stock', { p_lot: a.stock_lot_id, p_delta: a.delta, p_reason: a.reason, p_note: a.note });
  if (error) return failed(userMessage(error)!, formData);
  revalidatePath(`/inventory/lots/${a.stock_lot_id}`);
  return { ok: 'Change recorded.' };
}

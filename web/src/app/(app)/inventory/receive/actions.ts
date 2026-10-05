'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { receiveSchema } from '@/lib/inventory/schemas';
import { failed, type FormState } from '@/lib/patients/form-state';
import { userMessage } from '@/lib/db-errors';

export async function receiveStock(_prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission('inventory', 'edit');
  const parsed = receiveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const r = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('receive_stock', {
    p_product: r.product_id,
    p_qty: r.quantity,
    p_lot_no: r.lot_no || null,
    p_expiry: r.expiry,
    p_received_on: r.received_on,
    p_notes: r.notes,
  });
  if (error) return failed(userMessage(error)!, formData);
  redirect(`/inventory/lots/${data}`);
}

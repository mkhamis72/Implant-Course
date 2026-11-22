'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { userMessage } from '@/lib/db-errors';
import type { FormState } from '@/lib/patients/form-state';

const ids = (fd: FormData, name: string) => fd.getAll(name).map(String).filter(Boolean);

/** Admin → Catalogue: switches the changed library items and own products on or off in one call (save_catalogue, 0132). */
export async function saveCatalogue(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('save_catalogue', {
    p_items_on: ids(formData, 'on_item'), p_items_off: ids(formData, 'off_item'),
    p_products_on: ids(formData, 'on_product'), p_products_off: ids(formData, 'off_product'),
  });
  revalidatePath('/admin/catalogue');
  if (error) return { error: userMessage(error) ?? 'Could not save the catalogue.' };
  const row = (Array.isArray(data) ? data[0] : data) as { switched_on: number; switched_off: number } | null;
  return { ok: `Saved: ${row?.switched_on ?? 0} switched on, ${row?.switched_off ?? 0} switched off.` };
}

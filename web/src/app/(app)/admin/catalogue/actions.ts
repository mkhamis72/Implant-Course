'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { userMessage } from '@/lib/db-errors';
import type { FormState } from '@/lib/patients/form-state';

const ids = (fd: FormData, name: string) => fd.getAll(name).map(String).filter(Boolean);

/** Admin → Catalogue: switches the changed library items and own products on or off (0128). */
export async function saveCatalogue(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const supabase = await createClient();
  const calls: [string, Record<string, unknown>, 'on' | 'off'][] = [
    ['set_catalog_items', { p_item_ids: ids(formData, 'on_item'), p_on: true }, 'on'],
    ['set_catalog_items', { p_item_ids: ids(formData, 'off_item'), p_on: false }, 'off'],
    ['set_products_active', { p_product_ids: ids(formData, 'on_product'), p_on: true }, 'on'],
    ['set_products_active', { p_product_ids: ids(formData, 'off_product'), p_on: false }, 'off'],
  ];
  let on = 0;
  let off = 0;
  for (const [fn, args, way] of calls) {
    if ((Object.values(args)[0] as string[]).length === 0) continue;
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      revalidatePath('/admin/catalogue');
      return { error: userMessage(error) ?? 'Could not save the catalogue.' };
    }
    if (way === 'on') on += Number(data ?? 0);
    else off += Number(data ?? 0);
  }
  revalidatePath('/admin/catalogue');
  return { ok: `Saved: ${on} switched on, ${off} switched off.` };
}

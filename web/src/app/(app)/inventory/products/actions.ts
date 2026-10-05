'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { productSchema } from '@/lib/inventory/schemas';
import { failed, type FormState } from '@/lib/patients/form-state';
import { userMessage } from '@/lib/db-errors';

export async function createProduct(_prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission('inventory', 'edit');
  const parsed = productSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { data, error } = await supabase.from('products').insert(parsed.data).select('id').single();
  if (error) return failed(userMessage(error)!, formData);
  redirect(`/inventory/products/${data.id}`);
}

export async function updateProduct(_prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission('inventory', 'edit');
  const id = String(formData.get('id') ?? '');
  const parsed = productSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('products')
    .update({ ...parsed.data, active: formData.get('active') === 'on', is_sample: formData.get('is_sample') === 'on' })
    .eq('id', id)
    .select('id');
  if (error || !data?.length) return failed(userMessage(error) ?? 'Product not found.', formData);
  revalidatePath(`/inventory/products/${id}`);
  revalidatePath('/inventory');
  return { ok: 'Product saved.' };
}

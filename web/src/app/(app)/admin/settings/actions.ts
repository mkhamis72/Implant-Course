'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { settingsSchema, type ActionState } from '@/lib/admin/schemas';

export async function updateSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from('settings').update(parsed.data).eq('id', true);
  if (error) return { error: error.message };
  revalidatePath('/', 'layout');
  return { ok: 'Settings saved.' };
}

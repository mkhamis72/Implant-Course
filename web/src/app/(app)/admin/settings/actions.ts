'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { settingsSchema, type ActionState } from '@/lib/admin/schemas';
import { updateProblem } from '@/lib/admin/results';

export async function updateSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const problem = updateProblem(await supabase.from('settings').update(parsed.data).eq('id', true).select('id'));
  if (problem) return { error: problem };
  revalidatePath('/', 'layout');
  return { ok: 'Settings saved.' };
}

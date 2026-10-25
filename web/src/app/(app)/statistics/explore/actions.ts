'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { userMessage } from '@/lib/db-errors';
import { savedConfigSchema, savedCourse, type SavedConfig } from '@/lib/analysis/saved';

type Result = { error?: string; id?: string };

/** Adds (id null) or changes a saved analysis. The rules (title, creator or admin) live in save_analysis (0079). */
export async function saveAnalysis(id: string | null, title: string, config: SavedConfig): Promise<Result> {
  await requirePermission('research', 'edit');
  const parsed = savedConfigSchema.safeParse(config);
  if (!parsed.success) return { error: 'Could not save this analysis.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('save_analysis', {
    p_id: id, p_title: title.trim(), p_config: parsed.data, p_course: savedCourse(parsed.data),
  });
  if (error) return { error: userMessage(error) ?? undefined };
  revalidatePath('/statistics/explore');
  return { id: data as string };
}

export async function deleteAnalysis(id: string): Promise<Result> {
  await requirePermission('research', 'edit');
  const supabase = await createClient();
  const { error } = await supabase.rpc('delete_analysis', { p_id: id });
  if (error) return { error: userMessage(error) ?? undefined };
  revalidatePath('/statistics/explore');
  return {};
}

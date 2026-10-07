'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { settingsSchema, type ActionState } from '@/lib/admin/schemas';
import { updateProblem } from '@/lib/admin/results';
import { userMessage } from '@/lib/db-errors';
import { brandingSchema } from '@/lib/branding/schema';
import { encodeBytea, logoProblem, sniffLogo } from '@/lib/branding/image';

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

const branding = (ok: string): ActionState => {
  revalidatePath('/', 'layout');
  return { ok };
};

export async function saveBranding(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = brandingSchema.safeParse({
    name: formData.get('name'), brand_color: formData.get('brand_color'), nav_color: formData.get('nav_color'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  // Check the logo before saving anything, so a bad file never leaves a half-saved change.
  const file = formData.get('logo');
  const bytes = file instanceof File && file.size > 0 ? new Uint8Array(await file.arrayBuffer()) : null;
  const problem = bytes && logoProblem(bytes);
  if (problem) return { error: problem };
  const supabase = await createClient();
  const { error } = await supabase.rpc('update_branding', {
    p_name: parsed.data.name, p_brand_color: parsed.data.brand_color, p_nav_color: parsed.data.nav_color,
  });
  if (error) return { error: userMessage(error) ?? 'Could not save the branding.' };
  if (bytes) {
    const { error: logoError } = await supabase.rpc('set_branding_logo', { p_bytes: encodeBytea(bytes), p_content_type: sniffLogo(bytes)! });
    if (logoError) return { error: userMessage(logoError) ?? 'Could not save the logo.' };
  }
  return branding('Branding saved.');
}

export async function removeLogo(): Promise<ActionState> {
  await requireAdmin();
  const { error } = await (await createClient()).rpc('clear_branding_logo');
  if (error) return { error: userMessage(error) ?? 'Could not remove the logo.' };
  return branding('Logo removed.');
}

export async function resetBranding(): Promise<ActionState> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc('update_branding', { p_name: null, p_brand_color: null, p_nav_color: null });
  if (error) return { error: userMessage(error) ?? 'Could not reset the branding.' };
  const { error: logoError } = await supabase.rpc('clear_branding_logo');
  if (logoError) return { error: userMessage(logoError) ?? 'Could not remove the logo.' };
  return branding('Branding reset to the defaults.');
}

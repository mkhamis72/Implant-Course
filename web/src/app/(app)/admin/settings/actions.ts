'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { settingsSchema, type ActionState } from '@/lib/admin/schemas';
import { updateProblem } from '@/lib/admin/results';
import { failed, type FormState } from '@/lib/patients/form-state';
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

const branding = (ok: string): FormState => {
  revalidatePath('/', 'layout');
  return { ok };
};

async function saveBranding(formData: FormData): Promise<FormState> {
  const parsed = brandingSchema.safeParse({
    name: formData.get('name'), brand_color: formData.get('brand_color'), nav_color: formData.get('nav_color'),
  });
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  // Check the logo before saving anything, so a bad file never leaves a half-saved change.
  const file = formData.get('logo');
  const bytes = file instanceof File && file.size > 0 ? new Uint8Array(await file.arrayBuffer()) : null;
  const problem = bytes && logoProblem(bytes);
  if (problem) return failed(problem, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('update_branding', {
    p_name: parsed.data.name, p_brand_color: parsed.data.brand_color, p_nav_color: parsed.data.nav_color,
  });
  if (error) return failed(userMessage(error) ?? 'Could not save the branding.', formData);
  if (bytes) {
    const { error: logoError } = await supabase.rpc('set_branding_logo', { p_bytes: encodeBytea(bytes), p_content_type: sniffLogo(bytes)! });
    if (logoError) {
      revalidatePath('/', 'layout');
      return failed('Name and colours saved, but the logo could not be saved.', formData);
    }
  }
  return branding('Branding saved.');
}

async function removeLogo(): Promise<FormState> {
  const { error } = await (await createClient()).rpc('clear_branding_logo');
  if (error) return { error: userMessage(error) ?? 'Could not remove the logo.' };
  return branding('Logo removed.');
}

async function resetBranding(): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('update_branding', { p_name: null, p_brand_color: null, p_nav_color: null });
  if (error) return { error: userMessage(error) ?? 'Could not reset the branding.' };
  const { error: logoError } = await supabase.rpc('clear_branding_logo');
  if (logoError) return { error: userMessage(logoError) ?? 'Could not remove the logo.' };
  return branding('Branding reset to the defaults.');
}

export async function brandingAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const intent = formData.get('intent');
  if (intent === 'save') return saveBranding(formData);
  if (intent === 'remove') return removeLogo();
  if (intent === 'reset') return resetBranding();
  return { error: 'Unknown action.' };
}

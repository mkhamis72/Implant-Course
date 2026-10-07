'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission, type Profile } from '@/lib/auth/session';
import { getBranding } from '@/lib/branding/get';
import { assignmentEmail, assignmentNotice, type ItemSnapshot, type Notice } from '@/lib/checklists/notify';
import { addItemsSchema, itemEditSchema, newChecklistSchema, templateSchema } from '@/lib/checklists/schemas';
import { sendEmail } from '@/lib/email/send';
import { emailEnabled } from '@/lib/flags';
import { requestOrigin } from '@/lib/tenant/current';
import { failed, type FormState } from '@/lib/patients/form-state';
import { userMessage } from '@/lib/db-errors';

type Result = { error?: string };

export async function saveTemplate(_prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission('checklists', 'edit');
  const parsed = templateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const t = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('save_template', {
    p_template: t.id, p_name: t.name, p_applies_to: t.applies_to, p_is_default: t.is_default, p_items: t.items,
  });
  if (error) return failed(userMessage(error)!, formData);
  revalidatePath('/checklists/templates');
  if (!t.id) redirect(`/checklists/templates/${data}`);
  revalidatePath(`/checklists/templates/${t.id}`);
  return { ok: 'Template saved.' };
}

export async function deleteTemplate(_prev: Result, formData: FormData): Promise<Result> {
  await requirePermission('checklists', 'edit');
  const supabase = await createClient();
  const { data, error } = await supabase.from('checklist_templates').delete().eq('id', String(formData.get('id') ?? '')).select('id');
  if (error || !data?.length) {
    if (error) console.error('Template delete failed:', error.message);
    return { error: 'The template could not be deleted. Reload the page and try again.' };
  }
  revalidatePath('/checklists/templates');
  redirect('/checklists/templates');
}

export async function createChecklist(_prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission('checklists', 'edit');
  const parsed = newChecklistSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const c = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_checklist', { p_title: c.title, p_items: c.items, p_template: c.template_id });
  if (error) return failed(userMessage(error)!, formData);
  redirect(`/checklists/${data}`);
}

export async function addItems(_prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission('checklists', 'edit');
  const parsed = addItemsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc('add_checklist_items', { p_checklist: parsed.data.checklist_id, p_items: parsed.data.items });
  if (error) return failed(userMessage(error)!, formData);
  revalidatePath(`/checklists/${parsed.data.checklist_id}`);
  return { ok: 'Items added.' };
}

export async function renameChecklist(_prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission('checklists', 'edit');
  const id = String(formData.get('id') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  if (title.length < 2) return failed('Enter the checklist title (at least 2 characters).', formData);
  const supabase = await createClient();
  const { data, error } = await supabase.from('checklists').update({ title }).eq('id', id).select('id');
  if (error || !data?.length) return failed(userMessage(error) ?? 'Checklist not found.', formData);
  revalidatePath(`/checklists/${id}`);
  return { ok: 'Saved.' };
}

export async function toggleItem(input: { id: string; checklistId: string; done: boolean }): Promise<Result> {
  await requirePermission('checklists', 'edit');
  const supabase = await createClient();
  const { error } = await supabase.rpc('toggle_checklist_item', { p_item: input.id, p_done: input.done });
  if (error) return { error: userMessage(error)! };
  revalidatePath(`/checklists/${input.checklistId}`);
  return {};
}

export async function moveItem(input: { id: string; checklistId: string; direction: -1 | 1 }): Promise<Result> {
  await requirePermission('checklists', 'edit');
  const supabase = await createClient();
  const { error } = await supabase.rpc('move_checklist_item', { p_item: input.id, p_direction: input.direction });
  if (error) return { error: userMessage(error)! };
  revalidatePath(`/checklists/${input.checklistId}`);
  return {};
}

export async function editItem(input: Record<string, unknown> & { checklistId: string }): Promise<Result & { warning?: string }> {
  const profile = await requirePermission('checklists', 'edit');
  const parsed = itemEditSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { id, ...fields } = parsed.data;
  const supabase = await createClient();
  const { data: before } = await supabase
    .from('checklist_items')
    .select('text, assignee_id, due_date, checklist_id, checklist:checklists(title)')
    .eq('id', id)
    .maybeSingle<ItemSnapshot & { checklist_id: string; checklist: { title: string } | null }>();
  const { data, error } = await supabase.from('checklist_items').update(fields).eq('id', id).select('id');
  if (error || !data?.length) return { error: userMessage(error) ?? 'Item not found.' };
  revalidatePath(`/checklists/${input.checklistId}`);
  const notice = before && emailEnabled() ? assignmentNotice(before, fields, profile.user_id) : null;
  if (!notice || !before) return {};
  return notifyAssignee(notice, fields, before.checklist_id, before.checklist?.title ?? '', profile);
}

/** Emails the assignee about an edit that was already saved; a failure only adds a warning. */
async function notifyAssignee(notice: Notice, item: ItemSnapshot, checklistId: string, checklistTitle: string, by: Profile): Promise<{ warning?: string }> {
  const supabase = await createClient();
  const { data: assignee } = await supabase.from('profiles').select('full_name, email').eq('user_id', item.assignee_id!).maybeSingle();
  if (!assignee?.email) return {};
  const email = assignmentEmail(notice, {
    company: (await getBranding()).name,
    checklistTitle,
    item,
    by: by.full_name || by.email,
    link: `${await requestOrigin()}/checklists/${checklistId}`,
  });
  const sent = await sendEmail({ to: assignee.email, ...email });
  return sent === 'failed' ? { warning: `Saved, but the email to ${assignee.full_name || assignee.email} couldn't be sent.` } : {};
}

export async function deleteItem(input: { id: string; checklistId: string }): Promise<Result> {
  await requirePermission('checklists', 'edit');
  const supabase = await createClient();
  const { error } = await supabase.from('checklist_items').delete().eq('id', input.id);
  if (error) return { error: userMessage(error)! };
  revalidatePath(`/checklists/${input.checklistId}`);
  return {};
}

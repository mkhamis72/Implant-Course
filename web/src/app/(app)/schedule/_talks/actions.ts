'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { talkSchema, updateTalkSchema } from '@/lib/schedule/schemas';
import { isTalkKind, type TalkKind } from '@/lib/schedule/talks';
import { failed, type FormState } from '@/lib/patients/form-state';
import { userMessage } from '@/lib/db-errors';

const kindOf = (formData: FormData): TalkKind => {
  const k = formData.get('kind');
  return isTalkKind(k) ? k : 'lectures';
};

export async function createTalk(_prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission('schedule', 'edit');
  const parsed = talkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const t = parsed.data;
  const supabase = await createClient();
  const { data: session } = await supabase.from('sessions').select('date').eq('id', t.session_id).maybeSingle();
  if (!session) return failed('Choose a session.', formData);
  const { error } = await supabase.rpc('create_talk', {
    p_session: t.session_id, p_start: t.start, p_end: t.end, p_lecturer: t.lecturer_id, p_topic: t.topic, p_notes: t.notes,
  });
  if (error) return failed(userMessage(error)!, formData);
  const kind = kindOf(formData);
  revalidatePath(`/schedule/${kind}`);
  redirect(`/schedule/${kind}?date=${session.date}`);
}

export async function updateTalk(_prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission('schedule', 'edit');
  const parsed = updateTalkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const t = parsed.data;
  const supabase = await createClient();
  const { data: talk } = await supabase.from('talks').select('session:sessions(date)').eq('id', t.talk_id).maybeSingle();
  const date = (talk?.session as { date: string } | null | undefined)?.date;
  if (!date) return failed('Talk not found.', formData);
  const { error } = await supabase.rpc('update_talk', {
    p_talk: t.talk_id, p_start: t.start, p_end: t.end, p_lecturer: t.lecturer_id, p_topic: t.topic, p_notes: t.notes,
  });
  if (error) return failed(userMessage(error)!, formData);
  const kind = kindOf(formData);
  revalidatePath(`/schedule/${kind}`);
  redirect(`/schedule/${kind}?date=${date}`);
}

export async function deleteTalk(_prev: FormState, formData: FormData): Promise<FormState> {
  await requirePermission('schedule', 'edit');
  const supabase = await createClient();
  const { error } = await supabase.rpc('delete_talk', { p_talk: String(formData.get('talk_id') ?? '') });
  if (error) return { error: userMessage(error)! };
  revalidatePath(`/schedule/${kindOf(formData)}`);
  return { ok: 'Talk deleted.' };
}

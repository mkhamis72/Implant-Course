'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireActiveUser } from '@/lib/auth/session';
import { courseSchema, sessionSchema } from '@/lib/schedule/schemas';
import { failed, type FormState } from '@/lib/patients/form-state';
import { userMessage } from '@/lib/db-errors';

export async function createCourse(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const parsed = courseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { data, error } = await supabase.from('courses').insert(parsed.data).select('id').single();
  if (error) return failed(userMessage(error)!, formData);
  redirect(`/courses/${data.id}`);
}

export async function updateCourse(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const id = String(formData.get('id') ?? '');
  const parsed = courseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { data, error } = await supabase.from('courses').update(parsed.data).eq('id', id).select('id');
  if (error || !data?.length) return failed(userMessage(error) ?? 'Course not found.', formData);
  revalidatePath(`/courses/${id}`);
  return { ok: 'Course saved.' };
}

export async function addSession(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const parsed = sessionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failed(parsed.error.issues[0].message, formData);
  const supabase = await createClient();
  const { error } = await supabase.from('sessions').insert(parsed.data);
  if (error) return failed(userMessage(error)!, formData);
  revalidatePath(`/courses/${parsed.data.course_id}`);
  return { ok: 'Session added.' };
}

export async function enrollDelegate(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireActiveUser();
  const courseId = String(formData.get('course_id') ?? '');
  const delegateId = String(formData.get('delegate_id') ?? '');
  if (!delegateId) return { error: 'Choose a delegate.' };
  const supabase = await createClient();
  const { error } = await supabase.from('enrollments').insert({ course_id: courseId, delegate_id: delegateId });
  if (error) return { error: error.code === '23505' ? 'This delegate is already enrolled.' : userMessage(error)! };
  revalidatePath(`/courses/${courseId}`);
  return { ok: 'Delegate enrolled.' };
}

export async function unenrollDelegate(formData: FormData): Promise<void> {
  await requireActiveUser();
  const courseId = String(formData.get('course_id') ?? '');
  const supabase = await createClient();
  await supabase.from('enrollments').delete().eq('id', String(formData.get('enrollment_id') ?? ''));
  revalidatePath(`/courses/${courseId}`);
}

import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth/session';
import { todayIso } from '@/lib/dates';
import { formatDate } from '@/lib/format';
import { productLabel } from '@/lib/inventory/labels';
import type { Option, Product } from '@/lib/inventory/types';
import { SlotForm, type SessionOption } from './slot-form';
import { readParams, type PageSearchParams } from '@/lib/search-params';

export default async function NewBookingPage({
  searchParams,
}: {
  searchParams: PageSearchParams;
}) {
  const q = await readParams(searchParams, 'date', 'chair', 'time', 'session', 'patient');
  const supabase = await createClient();
  const me = await getCurrentProfile();
  const results = await Promise.all([
    supabase.from('sessions').select('id, title, date, start_time, course_id, course:courses(name)').eq('type', 'surgery')
      .gte('date', todayIso()).order('date'),
    supabase.from('chairs').select('id, name').eq('active', true).order('name'),
    supabase.from('patients').select('file_no, full_name').eq('archived', false).order('full_name').limit(2000),
    supabase.from('enrollments').select('course_id, delegate:delegates(id, full_name, active)'),
    supabase.from('products').select('*').eq('type', 'implant').eq('active', true),
    supabase.from('supervisors').select('id, full_name').eq('active', true).order('full_name'),
  ]);
  // A failed query must not look like an empty list (e.g. "no sessions").
  if (results.some((r) => r.error)) throw new Error('Could not load the booking form');
  const [{ data: sessions }, { data: chairs }, { data: patients }, { data: enrollments }, { data: implants }, { data: supervisors }] = results;

  const sessionOptions: SessionOption[] = ((sessions ?? []) as unknown as {
    id: string; title: string; date: string; course_id: string; course: { name: string } | null;
  }[]).map((s) => ({ id: s.id, courseId: s.course_id, label: `${formatDate(s.date)} · ${s.course?.name ?? ''} · ${s.title}` }));

  const enrolled: Record<string, Option[]> = {};
  for (const e of (enrollments ?? []) as unknown as { course_id: string; delegate: { id: string; full_name: string; active: boolean } | null }[]) {
    if (!e.delegate?.active) continue;
    (enrolled[e.course_id] ??= []).push({ id: e.delegate.id, label: e.delegate.full_name });
  }
  for (const list of Object.values(enrolled)) list.sort((a, b) => a.label.localeCompare(b.label));

  const initialSession = q.session || (sessionOptions.find((s) => s.label.startsWith(q.date ? formatDate(q.date) : '\u0000'))?.id ?? '');

  return (
    <div className="space-y-6">
      <h1>Book a surgery</h1>
      <SlotForm
        sessions={sessionOptions}
        chairs={(chairs ?? []).map((c) => ({ id: c.id as string, label: c.name as string }))}
        patients={(patients ?? []) as { file_no: string; full_name: string }[]}
        enrolled={enrolled}
        implants={((implants ?? []) as Product[]).sort((a, b) => productLabel(a).localeCompare(productLabel(b), undefined, { numeric: true }))}
        supervisors={(supervisors ?? []).map((s) => ({ id: s.id as string, label: s.full_name as string }))}
        me={me?.user_id ?? ''}
        initial={{ sessionId: initialSession, chairId: q.chair, start: q.time || '09:00', fileNo: q.patient }}
      />
    </div>
  );
}

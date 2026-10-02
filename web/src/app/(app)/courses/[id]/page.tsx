import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { formatDate } from '@/lib/format';
import { SESSION_TYPE_LABELS, type Course, type Session } from '@/lib/schedule/types';
import { CourseForm } from '../course-form';
import { unenrollDelegate, updateCourse } from '../actions';
import { SessionForm } from './session-form';
import { EnrollForm } from './enrollment';

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const [{ data: course }, { data: sessions }, { data: enrollments }, { data: delegates }, { data: organizers }] = await Promise.all([
    supabase.from('courses').select('*').eq('id', id).maybeSingle(),
    supabase.from('sessions').select('*').eq('course_id', id).order('date').order('start_time'),
    supabase.from('enrollments').select('id, delegate:delegates(id, full_name)').eq('course_id', id),
    supabase.from('delegates').select('id, full_name').eq('active', true).order('full_name'),
    supabase.from('profiles').select('user_id, full_name, email').eq('active', true).order('full_name'),
  ]);
  if (!course) notFound();
  const c = course as Course;
  const enrolled = (enrollments ?? []) as unknown as { id: string; delegate: { id: string; full_name: string } }[];
  const enrolledIds = new Set(enrolled.map((e) => e.delegate.id));
  const available = (delegates ?? []).filter((d) => !enrolledIds.has(d.id)).map((d) => ({ id: d.id as string, label: d.full_name as string }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{c.name}</h1>
      <CourseForm action={updateCourse} course={c} />
      <section className="space-y-3">
        <h2 className="font-semibold">Sessions</h2>
        <ul className="card divide-y divide-gray-100">
          {(sessions ?? []).length === 0 && <li className="text-sm text-gray-600">No sessions yet.</li>}
          {((sessions ?? []) as Session[]).map((s) => (
            <li key={s.id} data-testid="session-row" className="flex flex-wrap gap-x-6 py-2 text-sm">
              <span className="font-medium">{s.title}</span>
              <span>{SESSION_TYPE_LABELS[s.type]}</span>
              <span>{formatDate(s.date)} {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}</span>
              {s.type === 'surgery' && (
                <Link href={`/schedule?date=${s.date}`} className="text-blue-700 hover:underline">Schedule</Link>
              )}
            </li>
          ))}
        </ul>
        <SessionForm
          courseId={c.id}
          defaultDate={c.start_date}
          organizers={(organizers ?? []).map((o) => ({ id: o.user_id as string, label: (o.full_name || o.email) as string }))}
        />
      </section>
      <section className="card space-y-3">
        <h2 className="font-semibold">Enrolled delegates</h2>
        <ul className="space-y-1 text-sm">
          {enrolled.length === 0 && <li className="text-gray-600">Nobody enrolled yet.</li>}
          {enrolled.map((e) => (
            <li key={e.id} data-testid={`enrolled-${e.delegate.full_name}`} className="flex items-center gap-3">
              <Link href={`/delegates/${e.delegate.id}`} className="text-blue-700 hover:underline">{e.delegate.full_name}</Link>
              <form action={unenrollDelegate}>
                <input type="hidden" name="enrollment_id" value={e.id} />
                <input type="hidden" name="course_id" value={c.id} />
                <button className="text-sm text-red-700 hover:underline">Remove</button>
              </form>
            </li>
          ))}
        </ul>
        <EnrollForm courseId={c.id} available={available} />
      </section>
    </div>
  );
}

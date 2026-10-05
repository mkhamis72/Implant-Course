import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { canEdit } from '@/lib/auth/permissions';
import { formatDate } from '@/lib/format';
import type { Course } from '@/lib/schedule/types';
import { CourseForm } from './course-form';
import { createCourse } from './actions';

export default async function CoursesPage() {
  const profile = await requirePermission('courses');
  const editable = canEdit(profile, 'courses');
  const supabase = await createClient();
  const { data, error } = await supabase.from('courses').select('*').order('start_date', { ascending: false });
  if (error) throw new Error('Could not load courses');
  const courses = (data ?? []) as Course[];
  return (
    <div className="space-y-6">
      <h1>Courses</h1>
      {editable && (
        <section className="space-y-2">
          <h2 className="font-semibold">New course</h2>
          <CourseForm action={createCourse} />
        </section>
      )}
      <ul className="card divide-y divide-line">
        {courses.length === 0 && <li className="text-muted">No courses yet.</li>}
        {courses.map((c) => (
          <li key={c.id} className="flex flex-wrap gap-x-6 py-2 text-sm">
            <Link href={`/courses/${c.id}`} className="font-medium text-accent hover:underline">{c.name}</Link>
            <span>{formatDate(c.start_date)} – {formatDate(c.end_date)}</span>
            <span className="text-muted">{c.venue}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

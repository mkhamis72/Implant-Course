import { requirePermission } from '@/lib/auth/session';
import { canView } from '@/lib/auth/permissions';
import { createClient } from '@/lib/supabase/server';
import type { PageSearchParams } from '@/lib/search-params';
import { ALL_COURSES } from '@/lib/research/view';
import { todayIso } from '@/lib/dates';
import { courseOverview, selectedCourses, type CourseOption } from '@/lib/analysis/course-overview';
import { NoPatientsNote } from '../research-view';
import { loadAnalysisRows } from '../explore/data';
import { CourseView } from './course-view';

const NO_FILTERS = { course: ALL_COURSES, from: '', to: '', delegate: '', brand: '', system: '' };

export default async function CoursesPage({ searchParams }: { searchParams: PageSearchParams }) {
  const profile = await requirePermission('research');
  const header = (
    <div className="page-header">
      <div>
        <h1>Courses</h1>
        <p className="text-muted">What each course recorded, newest first. Tick a course for its full counts, or several to see them side by side.</p>
      </div>
    </div>
  );
  // The readers are security invoker over patient tables: without Patients view every figure would read as zero.
  if (!canView(profile, 'patients')) {
    return <div className="space-y-6">{header}<NoPatientsNote /></div>;
  }

  const supabase = await createClient();
  const [data, courses, sp] = await Promise.all([loadAnalysisRows(NO_FILTERS), supabase.rpc('course_options'), searchParams]);
  if (courses.error) throw new Error('Could not load the courses');
  const summaries = courseOverview(data, (courses.data ?? []) as CourseOption[], todayIso());

  return (
    <div className="space-y-6">
      {header}
      <CourseView summaries={summaries} selected={selectedCourses(sp.c, summaries)} />
    </div>
  );
}

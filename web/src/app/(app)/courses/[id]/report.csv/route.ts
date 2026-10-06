import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth/session';
import { canView } from '@/lib/auth/permissions';
import { contentDisposition, csvFilename } from '@/lib/csv';
import { courseReportCsv, type CourseReportRow } from '@/lib/reports/course-report';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile?.active || !canView(profile, 'courses')) return new NextResponse('Not allowed', { status: 403 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return new NextResponse('Not found', { status: 404 });
  const supabase = await createClient();
  const [{ data: course }, { data, error }] = await Promise.all([
    supabase.from('courses').select('name').eq('id', id).maybeSingle(),
    supabase.rpc('course_report', { p_course: id }),
  ]);
  if (!course || error) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(courseReportCsv((data ?? []) as CourseReportRow[]), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': contentDisposition(csvFilename(`${course.name} report`, id)),
    },
  });
}

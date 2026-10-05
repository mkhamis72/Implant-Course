import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth/session';
import { contentDisposition, csvFilename } from '@/lib/csv';
import { myReportCsv, type MyReportRow } from '@/lib/delegate-portal/report';

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile?.active || profile.role !== 'delegate') return new NextResponse('Not allowed', { status: 403 });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('my_report');
  if (error) return new NextResponse('Not allowed', { status: 403 });
  return new NextResponse(myReportCsv((data ?? []) as MyReportRow[]), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': contentDisposition(csvFilename(profile.full_name || 'my-report', 'my-report')),
    },
  });
}

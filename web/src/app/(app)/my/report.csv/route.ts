import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth/session';
import { contentDisposition, csvFilename } from '@/lib/csv';
import { myReportCsv, type MyReportRow, type MyRestorationRow } from '@/lib/delegate-portal/report';

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile?.active || profile.mfa_setup_required || profile.role !== 'delegate') return new NextResponse('Not allowed', { status: 403 });
  const supabase = await createClient();
  const [{ data, error }, { data: restoData, error: restoError }] = await Promise.all([supabase.rpc('my_report'), supabase.rpc('my_restorations')]);
  if (error || restoError) return new NextResponse('Not allowed', { status: 403 });
  return new NextResponse(myReportCsv((data ?? []) as MyReportRow[], (restoData ?? []) as MyRestorationRow[]), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': contentDisposition(csvFilename(profile.full_name || 'my-report', 'my-report')),
    },
  });
}

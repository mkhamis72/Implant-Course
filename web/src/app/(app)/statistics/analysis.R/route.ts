import { NextResponse } from 'next/server';
import { teachingOn } from '@/lib/modules/modules';
import { requirePermission } from '@/lib/auth/session';
import { analysisScript } from '@/lib/research/export/analysis';

/** The R analysis script on its own (it also ships in the CSV export zip). It holds no data. */
export async function GET() {
  const profile = await requirePermission('research');
  // The script stratifies by course and placing delegate, which a clinic's data doesn't have.
  if (!teachingOn(profile.features)) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(analysisScript(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'attachment; filename="analysis.R"',
      'Cache-Control': 'no-store',
    },
  });
}

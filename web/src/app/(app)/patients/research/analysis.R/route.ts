import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/session';
import { analysisScript } from '@/lib/research/export/analysis';

/** The R analysis script on its own (it also ships in the CSV export zip). It holds no data. */
export async function GET() {
  await requirePermission('research');
  return new NextResponse(analysisScript(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'attachment; filename="analysis.R"',
      'Cache-Control': 'no-store',
    },
  });
}

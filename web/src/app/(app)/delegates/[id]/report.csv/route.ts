import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth/session';
import { canView } from '@/lib/auth/permissions';
import { contentDisposition, csvFilename, toCsv } from '@/lib/csv';
import { productLabel } from '@/lib/inventory/labels';
import { OUTCOME_LABELS, SITE_STATE_LABELS, TECHNIQUE_LABELS, type FollowupOutcome, type SiteState } from '@/lib/inventory/types';
import type { ReportRow } from '@/lib/schedule/types';
import { restorationsCsvSection, type MyRestorationRow } from '@/lib/delegate-portal/report';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile?.active || profile.mfa_setup_required || !canView(profile, 'delegates')) return new NextResponse('Not allowed', { status: 403 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return new NextResponse('Not found', { status: 404 });
  const supabase = await createClient();
  const [{ data: delegate }, { data, error }, { data: restoData, error: restoError }] = await Promise.all([
    supabase.from('delegates').select('full_name').eq('id', id).maybeSingle(),
    supabase.rpc('delegate_report', { p_delegate: id }),
    supabase.rpc('delegate_restorations', { p_delegate: id }),
  ]);
  if (!delegate || error || restoError) return new NextResponse('Not found', { status: 404 });
  const rows = (data ?? []) as ReportRow[];
  const csv =
    toCsv(
    ['Course', 'Patient', 'File', 'Tooth', 'Role', 'Implant', 'Technique', 'Lot', 'Placed on', 'State', 'Last follow-up'],
    rows.map((r) => [
      r.course_name ?? '',
      r.patient_name,
      r.file_no,
      r.tooth,
      r.role === 'placing' ? 'Placed' : 'Assisted',
      r.product_id && r.type ? productLabel({ ...r, type: r.type, brand: r.brand ?? '', system: r.system ?? '', platform: r.platform ?? '', description: r.description ?? '' }) : '',
      r.technique ? TECHNIQUE_LABELS[r.technique] : '',
      r.lot_no ?? '',
      r.placed_on ?? '',
      SITE_STATE_LABELS[r.state as SiteState] ?? r.state,
      r.last_outcome ? OUTCOME_LABELS[r.last_outcome as FollowupOutcome] : '',
    ]),
  ) + restorationsCsvSection((restoData ?? []) as MyRestorationRow[]);
  const filename = csvFilename(delegate.full_name, id);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': contentDisposition(filename),
    },
  });
}

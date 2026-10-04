import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { formatDate } from '@/lib/format';
import { productLabel } from '@/lib/inventory/labels';
import { OUTCOME_LABELS, SITE_STATE_LABELS, TECHNIQUE_LABELS, type FollowupOutcome, type SiteState } from '@/lib/inventory/types';
import type { ReportRow } from '@/lib/schedule/types';
import { DelegateForm, type DelegateRow } from '../delegate-form';
import { updateDelegate } from '../actions';

function implantLabel(r: ReportRow): string {
  if (!r.type) return '—';
  return productLabel({
    ...r,
    type: r.type,
    brand: r.brand ?? '',
    system: r.system ?? '',
    platform: r.platform ?? '',
    description: r.description ?? '',
  });
}

export default async function DelegatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const [{ data }, { data: reportData }] = await Promise.all([
    supabase.from('delegates').select('id, full_name, phone, email, licence_no, notes, active').eq('id', id).maybeSingle(),
    supabase.rpc('delegate_report', { p_delegate: id }),
  ]);
  if (!data) notFound();
  const delegate = data as DelegateRow;
  const report = (reportData ?? []) as ReportRow[];

  return (
    <div className="space-y-6">
      <h1>{delegate.full_name}</h1>
      <DelegateForm action={updateDelegate} delegate={delegate} />
      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Implant record</h2>
          <a href={`/delegates/${delegate.id}/report.csv`} className="btn-secondary btn" download>
            Download CSV
          </a>
        </div>
        <p data-testid="report-totals" className="text-sm text-ink">
          Placed {report.filter((r) => r.role === 'placing').length} · Assisted{' '}
          {report.filter((r) => r.role === 'assisting').length} · Failed {report.filter((r) => r.state === 'failed').length} · Guided{' '}
          {report.filter((r) => r.technique === 'guided').length} · Free hand {report.filter((r) => r.technique === 'free_hand').length}
        </p>
        {report.length === 0 ? (
          <p className="text-sm text-muted">No implants recorded for this delegate yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Course</th>
                <th>Patient</th>
                <th>Tooth</th>
                <th>Role</th>
                <th>Implant</th>
                <th>Technique</th>
                <th>Placed</th>
                <th>State</th>
                <th>Last follow-up</th>
              </tr>
            </thead>
            <tbody>
              {report.map((r) => (
                <tr key={`${r.site_id}-${r.role}`} data-testid="report-row">
                  <td data-label="Course">{r.course_name ?? '—'}</td>
                  <td data-label="Patient">
                    <Link href={`/patients/${r.patient_id}?tooth=${r.tooth}`} className="text-accent hover:underline">
                      {r.patient_name}
                    </Link>
                  </td>
                  <td data-label="Tooth">{r.tooth}</td>
                  <td data-label="Role">{r.role === 'placing' ? 'Placed' : 'Assisted'}</td>
                  <td data-label="Implant">{implantLabel(r)}</td>
                  <td data-label="Technique">{r.technique ? TECHNIQUE_LABELS[r.technique] : '—'}</td>
                  <td data-label="Placed">{r.placed_on ? formatDate(r.placed_on) : '—'}</td>
                  <td data-label="State">{SITE_STATE_LABELS[r.state as SiteState] ?? r.state}</td>
                  <td data-label="Last follow-up">{r.last_outcome ? OUTCOME_LABELS[r.last_outcome as FollowupOutcome] : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

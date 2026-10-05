import { createClient } from '@/lib/supabase/server';
import { requireDelegate } from '@/lib/auth/session';
import { formatDate } from '@/lib/format';
import { TECHNIQUE_LABELS } from '@/lib/inventory/types';
import { implantOf, outcomeLabel, roleLabel, stateLabel, type MyReportRow } from '@/lib/delegate-portal/report';

export default async function MyReportPage() {
  await requireDelegate();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('my_report');
  if (error) throw new Error('Could not load your report');
  const report = (data ?? []) as MyReportRow[];

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1>My report</h1>
        <a href="/my/report.csv" className="btn-secondary btn" download>
          Download CSV
        </a>
      </div>
      <p data-testid="report-totals" className="text-sm text-ink">
        Placed {report.filter((r) => r.role === 'placing').length} · Assisted {report.filter((r) => r.role === 'assisting').length} · Guided{' '}
        {report.filter((r) => r.technique === 'guided').length} · Free hand {report.filter((r) => r.technique === 'free_hand').length}
      </p>
      <section className="card overflow-x-auto">
        {report.length === 0 ? (
          <p className="text-sm text-muted">No implants recorded for you yet.</p>
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
                    {r.patient_name} ({r.file_no})
                  </td>
                  <td data-label="Tooth">{r.tooth}</td>
                  <td data-label="Role">{roleLabel(r)}</td>
                  <td data-label="Implant">{implantOf(r)}</td>
                  <td data-label="Technique">{r.technique ? TECHNIQUE_LABELS[r.technique] : '—'}</td>
                  <td data-label="Placed">{r.placed_on ? formatDate(r.placed_on) : '—'}</td>
                  <td data-label="State">{stateLabel(r)}</td>
                  <td data-label="Last follow-up">{outcomeLabel(r) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

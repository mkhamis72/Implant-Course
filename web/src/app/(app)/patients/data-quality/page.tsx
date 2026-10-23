import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { formatDate } from '@/lib/format';
import { issueLink, sortIssues, type DataQualityIssue } from '@/lib/data-quality/issues';

export default async function DataQualityPage() {
  await requirePermission('patients');
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('data_quality_issues', { p_patient: null });
  if (error) throw new Error('Could not load the data-quality list');
  const rows = sortIssues((data ?? []) as DataQualityIssue[]);

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1>Data quality</h1>
          <p className="text-muted">Records with impossible dates: before the implant was placed, in the future, or a restoration problem before the restoration was fitted.</p>
        </div>
        <Link href="/patients" className="btn-secondary btn">Patients</Link>
      </div>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <p className="text-muted">No date problems found.</p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Patient</th><th>Tooth</th><th>Problem</th><th>Date</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.kind}-${r.record_table}-${r.record_id}-${r.site_id ?? ''}`} data-testid="data-quality-row">
                  <td data-label="Patient">
                    <Link href={`/patients/${r.patient_id}`} className="text-accent hover:underline">{r.patient_name}</Link>
                    <span className="ml-2 text-sm text-muted">{r.file_no}</span>
                  </td>
                  <td data-label="Tooth">{r.tooth ?? '—'}</td>
                  <td data-label="Problem">{r.message}</td>
                  <td data-label="Date">{formatDate(r.record_date)}</td>
                  <td data-label="Fix"><Link href={issueLink(r)} className="text-accent hover:underline">Fix</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

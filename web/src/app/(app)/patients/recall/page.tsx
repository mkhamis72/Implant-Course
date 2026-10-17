import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { formatDate } from '@/lib/format';
import type { PageSearchParams } from '@/lib/search-params';
import { RECALL_STATUSES, parseRecallStatuses, type RecallRow } from '@/lib/visits/recall';
import { VISIT_STATUS_BADGE, VISIT_STATUS_LABELS } from '@/lib/visits/visits';

const asList = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export default async function RecallPage({ searchParams }: { searchParams: PageSearchParams }) {
  await requirePermission('patients');
  const sp = await searchParams;
  const statuses = parseRecallStatuses(asList(sp.status));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('recall_list');
  if (error) throw new Error('Could not load the recall list');
  const rows = ((data ?? []) as RecallRow[]).filter((r) => statuses.includes(r.status));

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1>Recall list</h1>
          <p className="text-muted">Follow-up visits that are due, overdue, or missed in the last 60 days.</p>
        </div>
        <Link href="/patients" className="btn-secondary btn">Patients</Link>
      </div>
      <form className="card flex flex-wrap items-end gap-2">
        <fieldset className="flex flex-wrap gap-2">
          <legend className="label">Show</legend>
          {RECALL_STATUSES.map((s) => (
            <label key={s}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-sm hover:bg-sunken has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
              <input type="checkbox" name="status" value={s} defaultChecked={statuses.includes(s)} />
              {s === 'missed' ? 'Missed (60 days)' : VISIT_STATUS_LABELS[s]}
            </label>
          ))}
        </fieldset>
        <button className="btn-secondary btn">Apply</button>
      </form>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <p className="text-muted">Nobody to recall.</p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Patient</th><th>Phone</th><th>Tooth</th><th>Visit</th><th>Target</th><th>Window closes</th><th>Status</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.site_id}-${r.visit_key}`} data-testid="recall-row">
                  <td data-label="Patient">
                    <Link href={`/patients/${r.patient_id}?tooth=${r.tooth}`} className="text-accent hover:underline">{r.full_name}</Link>
                  </td>
                  <td data-label="Phone">{r.phone || '—'}</td>
                  <td data-label="Tooth">{r.tooth}</td>
                  <td data-label="Visit">{r.label}</td>
                  <td data-label="Target">{formatDate(r.target_date)}</td>
                  <td data-label="Window closes">{formatDate(r.window_end)}</td>
                  <td data-label="Status"><span className={VISIT_STATUS_BADGE[r.status]}>{VISIT_STATUS_LABELS[r.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

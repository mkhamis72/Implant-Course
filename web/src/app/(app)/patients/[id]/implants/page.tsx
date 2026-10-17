import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { currentComponent, lastFollowup } from '@/lib/inventory/components';
import { productLabel } from '@/lib/inventory/labels';
import { COMPONENT_LABELS, SITE_STATE_LABELS, TECHNIQUE_LABELS, type ImplantSite } from '@/lib/inventory/types';
import { formatDate } from '@/lib/format';
import { nextVisit, visitResult, VISIT_STATUS_LABELS, type VisitRow } from '@/lib/visits/visits';
import { surgeryCompleteness } from '@/lib/implants/surgery';
import { isOpen } from '@/lib/implants/complications';
import { SITE_SELECT, sortSite } from '../chart-data';

export default async function ImplantsPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('patients');
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('implant_sites')
    .select(SITE_SELECT)
    .eq('patient_id', id)
    .neq('state', 'removed')
    .order('tooth');
  if (error) throw new Error('Could not load implants');
  const sites = ((data ?? []) as unknown as ImplantSite[]).map(sortSite);
  const visitsRes = await supabase.rpc('implant_visits', { p_patient: id });
  if (visitsRes.error) throw new Error('Could not load implants');
  const visits = (visitsRes.data ?? []) as VisitRow[];

  return (
    <section className="card overflow-x-auto">
      {sites.length === 0 ? (
        <p className="text-muted">No implants recorded for this patient.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Tooth</th>
              <th>State</th>
              <th>Implant</th>
              <th>Technique</th>
              <th>Batch</th>
              <th>Placed</th>
              <th>Placed by</th>
              <th>Supervisor</th>
              <th>Component</th>
              <th>Last follow-up</th>
              <th>Next visit</th>
              <th>Open complications</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {sites.map((s) => {
              const current = currentComponent(s);
              const last = lastFollowup(s);
              const details = surgeryCompleteness(s.surgery);
              return (
                <tr key={s.id} data-testid="implant-row">
                  <td data-label="Tooth">
                    <Link href={`/patients/${id}?tooth=${s.tooth}`} className="text-accent hover:underline">
                      {s.tooth}
                    </Link>
                  </td>
                  <td data-label="State">{SITE_STATE_LABELS[s.state]}</td>
                  <td data-label="Implant">{s.product ? productLabel(s.product) : '—'}</td>
                  <td data-label="Technique">{s.technique ? TECHNIQUE_LABELS[s.technique] : '—'}</td>
                  <td data-label="Batch">{s.lot ? s.lot.lot_no ?? 'No lot' : '—'}</td>
                  <td data-label="Placed">{s.placed_on ? formatDate(s.placed_on) : '—'}</td>
                  <td data-label="Placed by">{s.placing?.full_name ?? '—'}</td>
                  <td data-label="Supervisor">{s.supervisor?.full_name || '—'}</td>
                  <td data-label="Component">{current ? COMPONENT_LABELS[current.component_type] : '—'}</td>
                  <td data-label="Last follow-up">{last ? `${visitResult(last)} (${last.check_type})` : '—'}</td>
                  <td data-label="Next visit" data-testid="next-visit">
                    {(() => {
                      const next = nextVisit(visits, s.id);
                      return next ? `${next.label} · ${formatDate(next.target_date)} · ${VISIT_STATUS_LABELS[next.status]}` : '—';
                    })()}
                  </td>
                  <td data-label="Open complications" data-testid="open-complications">{(s.complications ?? []).filter(isOpen).length || '—'}</td>
                  <td data-label="Details" data-testid="details-completeness">
                    {s.state === 'placed' || s.state === 'restored' || s.state === 'failed' ? `${details.recorded}/${details.total}` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

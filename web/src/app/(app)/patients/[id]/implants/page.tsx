import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { currentComponent, lastFollowup } from '@/lib/inventory/components';
import { productLabel } from '@/lib/inventory/labels';
import { COMPONENT_LABELS, OUTCOME_LABELS, SITE_STATE_LABELS, type ImplantSite } from '@/lib/inventory/types';
import { formatDate } from '@/lib/format';
import { SITE_SELECT, sortSite } from '../chart-data';

export default async function ImplantsPage({ params }: { params: Promise<{ id: string }> }) {
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

  return (
    <section className="card overflow-x-auto">
      {sites.length === 0 ? (
        <p className="text-gray-600">No implants recorded for this patient.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-gray-500">
              <th className="pb-2">Tooth</th>
              <th className="pb-2">State</th>
              <th className="pb-2">Implant</th>
              <th className="pb-2">Batch</th>
              <th className="pb-2">Placed</th>
              <th className="pb-2">Placed by</th>
              <th className="pb-2">Supervisor</th>
              <th className="pb-2">Component</th>
              <th className="pb-2">Last follow-up</th>
            </tr>
          </thead>
          <tbody>
            {sites.map((s) => {
              const current = currentComponent(s);
              const last = lastFollowup(s);
              return (
                <tr key={s.id} data-testid="implant-row" className="border-t border-gray-200">
                  <td className="py-2 pr-4">
                    <Link href={`/patients/${id}?tooth=${s.tooth}`} className="text-blue-700 hover:underline">
                      {s.tooth}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{SITE_STATE_LABELS[s.state]}</td>
                  <td className="py-2 pr-4">{s.product ? productLabel(s.product) : '—'}</td>
                  <td className="py-2 pr-4">{s.lot ? s.lot.lot_no ?? 'No lot' : '—'}</td>
                  <td className="py-2 pr-4">{s.placed_on ? formatDate(s.placed_on) : '—'}</td>
                  <td className="py-2 pr-4">{s.placing?.full_name ?? '—'}</td>
                  <td className="py-2 pr-4">{s.supervisor?.full_name || s.supervisor?.email || '—'}</td>
                  <td className="py-2 pr-4">{current ? COMPONENT_LABELS[current.component_type] : '—'}</td>
                  <td className="py-2">{last ? `${OUTCOME_LABELS[last.outcome]} (${last.check_type})` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

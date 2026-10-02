import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { isRealDate, todayIso } from '@/lib/dates';
import { formatDate } from '@/lib/format';
import { productLabel } from '@/lib/inventory/labels';
import type { PullRow } from '@/lib/schedule/types';
import { PrintButton } from './print-button';
import { readParams, type PageSearchParams } from '@/lib/search-params';

export default async function PullListPage({ searchParams }: { searchParams: PageSearchParams }) {
  const raw = (await readParams(searchParams, 'date')).date || undefined;
  const date = raw && isRealDate(String(raw)) ? String(raw) : todayIso();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('pull_list', { p_date: date });
  if (error) throw new Error('Could not load the pull list');
  const rows = (data ?? []) as PullRow[];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1>Pull list · {formatDate(date)}</h1>
        <Link href={`/schedule?date=${date}`} className="text-accent hover:underline print:hidden">Back to schedule</Link>
        <PrintButton />
      </div>
      <div className="card">
        {rows.length === 0 ? (
          <p className="text-muted">No planned implants on this day.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Implant</th>
                <th className="text-right">Needed</th>
                <th className="text-right">Usable stock</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const short = r.needed - r.available;
                return (
                  <tr key={r.product_id ?? 'unchosen'} data-testid="pull-row">
                    <td data-label="Implant">{r.product_id ? productLabel(r) : 'Implant not chosen yet'}</td>
                    <td data-label="Needed" className="text-right">{r.needed}</td>
                    <td data-label="Usable stock" className="text-right">{r.product_id ? r.available : '—'}</td>
                    <td>
                      {r.product_id && short > 0 && <span className="badge badge-bad">Short by {short}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

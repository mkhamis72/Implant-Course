import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { isRealDate, todayIso } from '@/lib/dates';
import { formatDate } from '@/lib/format';
import { productLabel } from '@/lib/inventory/labels';
import type { PullRow } from '@/lib/schedule/types';
import { PrintButton } from './print-button';

export default async function PullListPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date: raw } = await searchParams;
  const date = raw && isRealDate(String(raw)) ? String(raw) : todayIso();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('pull_list', { p_date: date });
  if (error) throw new Error('Could not load the pull list');
  const rows = (data ?? []) as PullRow[];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Pull list · {formatDate(date)}</h1>
        <Link href={`/schedule?date=${date}`} className="text-blue-700 hover:underline print:hidden">Back to schedule</Link>
        <PrintButton />
      </div>
      <div className="card">
        {rows.length === 0 ? (
          <p className="text-gray-600">No planned implants on this day.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-gray-500">
                <th className="pb-2">Implant</th>
                <th className="pb-2 text-right">Needed</th>
                <th className="pb-2 text-right">Usable stock</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const short = r.needed - r.available;
                return (
                  <tr key={r.product_id ?? 'unchosen'} data-testid="pull-row" className="border-t border-gray-200">
                    <td className="py-2 pr-4">{r.product_id ? productLabel(r) : 'Implant not chosen yet'}</td>
                    <td className="py-2 pr-4 text-right">{r.needed}</td>
                    <td className="py-2 pr-4 text-right">{r.product_id ? r.available : '—'}</td>
                    <td className="py-2">
                      {r.product_id && short > 0 && <span className="rounded bg-red-100 px-1.5 text-xs text-red-800">Short by {short}</span>}
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

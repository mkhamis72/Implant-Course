import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { productLabel } from '@/lib/inventory/labels';
import type { ProductType } from '@/lib/inventory/types';
import { formatDate } from '@/lib/format';

type Hit = {
  stock_lot_id: string;
  lot_no: string;
  expiry: string | null;
  received_on: string;
  on_hand: number;
  type: ProductType;
  brand: string;
  system: string;
  platform: string;
  diameter_mm: number | null;
  length_mm: number | null;
  description: string;
};

export default async function RecallPage({ searchParams }: { searchParams: Promise<{ lot?: string }> }) {
  const { lot = '' } = await searchParams;
  const q = String(lot).trim();
  let hits: Hit[] = [];
  if (q) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('search_lots', { q });
    if (error) throw new Error('Could not search batches');
    hits = (data ?? []) as Hit[];
  }
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Recall lookup</h1>
      <form className="card flex flex-wrap items-end gap-4" role="search">
        <label className="block min-w-64 flex-1">
          <span className="label">Lot number</span>
          <input className="input" name="lot" defaultValue={q} />
        </label>
        <button className="btn">Find</button>
      </form>
      {q && (
        <div className="card">
          {hits.length === 0 ? (
            <p className="text-gray-600">No batch with a lot number containing “{q}”.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {hits.map((h) => (
                <li key={h.stock_lot_id} className="flex flex-wrap gap-x-6 py-2 text-sm">
                  <Link href={`/inventory/lots/${h.stock_lot_id}`} className="font-medium text-blue-700 hover:underline">
                    {h.lot_no}
                  </Link>
                  <span>{productLabel(h)}</span>
                  <span className="text-gray-600">received {formatDate(h.received_on)}</span>
                  <span className="text-gray-600">{h.on_hand} on hand</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

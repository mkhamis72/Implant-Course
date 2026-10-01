import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getSettings } from '@/lib/auth/session';
import { todayIso } from '@/lib/dates';
import { productLabel } from '@/lib/inventory/labels';
import { stockFlags } from '@/lib/inventory/lots';
import { PRODUCT_TYPE_LABELS, type Product } from '@/lib/inventory/types';
import { formatDate } from '@/lib/format';

type Row = Product & { on_hand: number; nearest_expiry: string | null };

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; all?: string }>;
}) {
  const { q = '', category = '', all } = await searchParams;
  const supabase = await createClient();
  const [{ data, error }, settings] = await Promise.all([
    supabase.rpc('inventory_overview', { q: String(q), p_category: String(category), include_all: all === '1' }),
    getSettings(),
  ]);
  if (error) throw new Error('Could not load stock');
  const rows = (data ?? []) as Row[];
  const today = todayIso();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Stock</h1>
      <form className="card flex flex-wrap items-end gap-4" role="search">
        <label className="block min-w-64 flex-1">
          <span className="label">Search products</span>
          <input className="input" name="q" defaultValue={q} placeholder="Brand, system, size or reference" />
        </label>
        <label className="block">
          <span className="label">Category</span>
          <select className="input" name="category" defaultValue={category}>
            <option value="">All</option>
            <option value="surgical">Surgical</option>
            <option value="prosthetic">Prosthetic</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="all" value="1" defaultChecked={all === '1'} />
          Show the whole catalog
        </label>
        <button className="btn-secondary btn">Search</button>
      </form>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <p className="text-gray-600">
            No stocked products match. Tick “Show the whole catalog” to see every product, or receive stock.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-gray-500">
                <th className="pb-2">Product</th>
                <th className="pb-2">Type</th>
                <th className="pb-2 text-right">On hand</th>
                <th className="pb-2 text-right">Reorder at</th>
                <th className="pb-2">Nearest expiry</th>
                <th className="pb-2">Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const flags = stockFlags(r, today, settings.expiry_alert_days);
                return (
                  <tr key={r.id} data-testid={`stock-row-${r.id}`} className="border-t border-gray-200">
                    <td className="py-2 pr-4">
                      <Link href={`/inventory/products/${r.id}`} className="text-blue-700 hover:underline">
                        {productLabel(r)}
                      </Link>
                      {!r.active && <span className="ml-2 text-xs text-gray-500">(inactive)</span>}
                    </td>
                    <td className="py-2 pr-4">{PRODUCT_TYPE_LABELS[r.type]}</td>
                    <td className="py-2 pr-4 text-right font-medium">{r.on_hand}</td>
                    <td className="py-2 pr-4 text-right">{r.reorder_level || '—'}</td>
                    <td className="py-2 pr-4">{r.nearest_expiry ? formatDate(r.nearest_expiry) : '—'}</td>
                    <td className="space-x-1 py-2">
                      {flags.low && <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-900">Low stock</span>}
                      {flags.expiring && <span className="rounded bg-red-100 px-1.5 text-xs text-red-800">Expiring</span>}
                      {r.is_sample && <span className="rounded bg-gray-100 px-1.5 text-xs text-gray-700">Sample — verify</span>}
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

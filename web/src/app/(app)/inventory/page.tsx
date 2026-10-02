import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getSettings } from '@/lib/auth/session';
import { todayIso } from '@/lib/dates';
import { productLabel } from '@/lib/inventory/labels';
import { stockFlags } from '@/lib/inventory/lots';
import { PRODUCT_TYPE_LABELS, type Product } from '@/lib/inventory/types';
import { formatDate } from '@/lib/format';
import { readParams, type PageSearchParams } from '@/lib/search-params';

type Row = Product & { on_hand: number; nearest_expiry: string | null };

export default async function StockPage({
  searchParams,
}: {
  searchParams: PageSearchParams;
}) {
  const { q, category, all } = await readParams(searchParams, 'q', 'category', 'all');
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
      <h1>Stock</h1>
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
          <p className="text-muted">
            No stocked products match. Tick “Show the whole catalog” to see every product, or receive stock.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Type</th>
                <th className="text-right">On hand</th>
                <th className="text-right">Reorder at</th>
                <th>Nearest expiry</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const flags = stockFlags(r, today, settings.expiry_alert_days);
                return (
                  <tr key={r.id} data-testid={`stock-row-${r.id}`}>
                    <td data-label="Product">
                      <Link href={`/inventory/products/${r.id}`} className="text-accent hover:underline">
                        {productLabel(r)}
                      </Link>
                      {!r.active && <span className="ml-2 text-xs text-muted">(inactive)</span>}
                    </td>
                    <td data-label="Type">{PRODUCT_TYPE_LABELS[r.type]}</td>
                    <td data-label="On hand" className="text-right font-medium">{r.on_hand}</td>
                    <td data-label="Reorder at" className="text-right">{r.reorder_level || '—'}</td>
                    <td data-label="Nearest expiry">{r.nearest_expiry ? formatDate(r.nearest_expiry) : '—'}</td>
                    <td data-label="Flags" className="space-x-1">
                      {flags.low && <span className="badge badge-warn">Low stock</span>}
                      {flags.expiring && <span className="badge badge-bad">Expiring</span>}
                      {r.is_sample && <span className="badge">Sample — verify</span>}
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

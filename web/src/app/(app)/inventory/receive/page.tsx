import { createClient } from '@/lib/supabase/server';
import { todayIso } from '@/lib/dates';
import { productLabel } from '@/lib/inventory/labels';
import type { Product } from '@/lib/inventory/types';
import { ReceiveForm } from './receive-form';
import { readParams, type PageSearchParams } from '@/lib/search-params';

export default async function ReceivePage({ searchParams }: { searchParams: PageSearchParams }) {
  const { product } = await readParams(searchParams, 'product');
  const supabase = await createClient();
  const { data, error } = await supabase.from('products').select('*').eq('active', true);
  if (error) throw new Error('Could not load products');
  const products = (data ?? []) as Product[];
  const byBrand = new Map<string, { id: string; label: string }[]>();
  for (const p of products) {
    const list = byBrand.get(p.brand) ?? [];
    list.push({ id: p.id, label: productLabel(p) });
    byBrand.set(p.brand, list);
  }
  const groups = [...byBrand.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([brand, options]) => ({ brand, options: options.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })) }));
  return (
    <div className="space-y-6">
      <h1>Receive stock</h1>
      <ReceiveForm groups={groups} productId={String(product)} today={todayIso()} />
    </div>
  );
}

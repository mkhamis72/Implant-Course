import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { productLabel } from '@/lib/inventory/labels';
import type { LotOnHand, Product } from '@/lib/inventory/types';
import { formatDate } from '@/lib/format';
import { ProductForm } from '../product-form';
import { updateProduct } from '../actions';

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const [{ data: product }, { data: lots }] = await Promise.all([
    supabase.from('products').select('*').eq('id', id).maybeSingle(),
    supabase.from('stock_on_hand').select('*').eq('product_id', id).order('received_on', { ascending: false }),
  ]);
  if (!product) notFound();
  const p = product as Product;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{productLabel(p)}</h1>
        <Link href={`/inventory/receive?product=${p.id}`} className="btn">
          Receive stock
        </Link>
      </div>
      <ProductForm action={updateProduct} product={p} />
      <section className="card space-y-3">
        <h2 className="font-semibold">Batches</h2>
        {(lots ?? []).length === 0 ? (
          <p className="text-sm text-gray-600">No stock received yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-gray-500">
                <th className="pb-2">Lot</th>
                <th className="pb-2">Expiry</th>
                <th className="pb-2">Received</th>
                <th className="pb-2 text-right">On hand</th>
              </tr>
            </thead>
            <tbody>
              {(lots as LotOnHand[]).map((l) => (
                <tr key={l.stock_lot_id} className="border-t border-gray-200">
                  <td className="py-2 pr-4">
                    <Link href={`/inventory/lots/${l.stock_lot_id}`} className="text-blue-700 hover:underline">
                      {l.lot_no ?? 'No lot'}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{l.expiry ? formatDate(l.expiry) : '—'}</td>
                  <td className="py-2 pr-4">{formatDate(l.received_on)}</td>
                  <td className="py-2 text-right">{l.on_hand}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

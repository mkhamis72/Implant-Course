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
      <div className="page-header">
        <h1>{productLabel(p)}</h1>
        <Link href={`/inventory/receive?product=${p.id}`} className="btn">
          Receive stock
        </Link>
      </div>
      <ProductForm action={updateProduct} product={p} />
      <section className="card space-y-3">
        <h2 className="font-semibold">Batches</h2>
        {(lots ?? []).length === 0 ? (
          <p className="text-sm text-muted">No stock received yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Lot</th>
                <th>Expiry</th>
                <th>Received</th>
                <th className="text-right">On hand</th>
              </tr>
            </thead>
            <tbody>
              {(lots as LotOnHand[]).map((l) => (
                <tr key={l.stock_lot_id}>
                  <td data-label="Lot">
                    <Link href={`/inventory/lots/${l.stock_lot_id}`} className="text-accent hover:underline">
                      {l.lot_no ?? 'No lot'}
                    </Link>
                  </td>
                  <td data-label="Expiry">{l.expiry ? formatDate(l.expiry) : '—'}</td>
                  <td data-label="Received">{formatDate(l.received_on)}</td>
                  <td data-label="On hand" className="text-right">{l.on_hand}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

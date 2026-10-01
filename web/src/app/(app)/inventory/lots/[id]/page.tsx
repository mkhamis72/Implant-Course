import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { productLabel } from '@/lib/inventory/labels';
import { COMPONENT_LABELS, MOVEMENT_REASON_LABELS, type ComponentType, type LotOnHand, type Product } from '@/lib/inventory/types';
import { formatDate, formatDateTime } from '@/lib/format';
import { AdjustForm } from './adjust-form';

type Movement = {
  id: string;
  delta: number;
  reason: string;
  note: string;
  created_at: string;
  creator: { full_name: string; email: string } | null;
  patient: { id: string; full_name: string; file_no: string } | null;
};

type Usage = {
  movement_id: string;
  used_on: string;
  patient_id: string;
  patient_name: string;
  file_no: string;
  tooth: number;
  item: string;
  placing_delegate: string | null;
  supervisor: string | null;
};

export default async function LotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const { data: lot } = await supabase.from('stock_on_hand').select('*').eq('stock_lot_id', id).maybeSingle();
  if (!lot) notFound();
  const l = lot as LotOnHand;
  const [{ data: product }, { data: movements }, { data: usage }] = await Promise.all([
    supabase.from('products').select('*').eq('id', l.product_id).single(),
    supabase
      .from('stock_movements')
      .select('id, delta, reason, note, created_at, creator:profiles(full_name, email), patient:patients(id, full_name, file_no)')
      .eq('stock_lot_id', id)
      .order('created_at', { ascending: false }),
    supabase.rpc('lot_usage', { p_lot: id }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{l.lot_no ? `Lot ${l.lot_no}` : 'No lot number'}</h1>
        <p className="text-gray-600">
          <Link href={`/inventory/products/${l.product_id}`} className="text-blue-700 hover:underline">
            {product ? productLabel(product as Product) : 'Product'}
          </Link>
        </p>
      </div>
      <dl className="card grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className="text-sm text-gray-500">On hand</dt>
          <dd className="text-2xl font-semibold" data-testid="on-hand">{l.on_hand}</dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">Received</dt>
          <dd>{l.qty_received} on {formatDate(l.received_on)}</dd>
        </div>
        <div>
          <dt className="text-sm text-gray-500">Expiry</dt>
          <dd>{l.expiry ? formatDate(l.expiry) : '—'}</dd>
        </div>
      </dl>
      <AdjustForm lotId={id} />
      <section className="card space-y-3">
        <h2 className="font-semibold">Used in (recall)</h2>
        {(usage ?? []).length === 0 ? (
          <p className="text-sm text-gray-600">Not used for any patient yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-gray-500">
                <th className="pb-2">Date</th>
                <th className="pb-2">Patient</th>
                <th className="pb-2">Tooth</th>
                <th className="pb-2">Item</th>
                <th className="pb-2">Placed by</th>
                <th className="pb-2">Supervisor</th>
              </tr>
            </thead>
            <tbody>
              {(usage as Usage[]).map((u) => (
                <tr key={u.movement_id} data-testid="usage-row" className="border-t border-gray-200">
                  <td className="py-2 pr-4">{formatDate(u.used_on)}</td>
                  <td className="py-2 pr-4">
                    <Link href={`/patients/${u.patient_id}?tooth=${u.tooth}`} className="text-blue-700 hover:underline">
                      {u.patient_name}
                    </Link>{' '}
                    <span className="text-gray-500">({u.file_no})</span>
                  </td>
                  <td className="py-2 pr-4">{u.tooth}</td>
                  <td className="py-2 pr-4">{u.item === 'implant' ? 'Implant' : COMPONENT_LABELS[u.item as ComponentType]}</td>
                  <td className="py-2 pr-4">{u.placing_delegate ?? '—'}</td>
                  <td className="py-2">{u.supervisor ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="card space-y-3">
        <h2 className="font-semibold">Ledger</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-gray-500">
              <th className="pb-2">When</th>
              <th className="pb-2">What</th>
              <th className="pb-2 text-right">Change</th>
              <th className="pb-2">By</th>
              <th className="pb-2">Note / patient</th>
            </tr>
          </thead>
          <tbody>
            {((movements ?? []) as unknown as Movement[]).map((m) => (
              <tr key={m.id} data-testid="ledger-row" className="border-t border-gray-200">
                <td className="py-2 pr-4">{formatDateTime(m.created_at)}</td>
                <td className="py-2 pr-4">{MOVEMENT_REASON_LABELS[m.reason] ?? m.reason}</td>
                <td className="py-2 pr-4 text-right font-mono">{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                <td className="py-2 pr-4">{m.creator?.full_name || m.creator?.email || '—'}</td>
                <td className="py-2">
                  {m.patient ? (
                    <Link href={`/patients/${m.patient.id}`} className="text-blue-700 hover:underline">
                      {m.patient.full_name}
                    </Link>
                  ) : (
                    m.note || '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

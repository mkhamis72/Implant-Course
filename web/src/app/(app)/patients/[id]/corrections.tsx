'use client';

import { useState, useTransition } from 'react';
import { acceptsProduct, currentComponent } from '@/lib/inventory/components';
import { lotLabel, productLabel } from '@/lib/inventory/labels';
import { COMPONENT_LABELS, OUTCOME_LABELS, type ChartData, type ImplantSite, type LotOnHand } from '@/lib/inventory/types';
import { formatDate } from '@/lib/format';
import { correctBatch, voidComponent, voidFollowup } from './implant-actions';

type Result = { error?: string };

function useRun() {
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>) => {
    setError(null);
    setOk(null);
    start(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else setOk('Correction saved.');
    });
  };
  return { error, ok, pending, run };
}

/** Batches a correction may point to: in stock, other than the current one, and not expired on the day of use. */
function correctionLots(lots: readonly LotOnHand[], productId: string, currentLotId: string | null, usedOn: string | null): LotOnHand[] {
  return lots.filter(
    (l) => l.product_id === productId && l.on_hand > 0 && l.stock_lot_id !== currentLotId && !(l.expiry && usedOn && l.expiry < usedOn),
  );
}

export function Corrections({ patientId, site, data }: { patientId: string; site: ImplantSite; data: ChartData }) {
  const { error, ok, pending, run } = useRun();
  const stockComponents = site.components.filter((c) => !c.voided_at && c.stock_lot_id && c.product);
  const [target, setTarget] = useState('implant');
  const component = stockComponents.find((c) => c.id === target) ?? null;
  const currentProductId = component ? component.product!.id : (site.product?.id ?? '');
  const [productId, setProductId] = useState(currentProductId);
  const [lotId, setLotId] = useState('');
  const [batchReason, setBatchReason] = useState('');
  const [followupReason, setFollowupReason] = useState('');
  const [componentReason, setComponentReason] = useState('');

  const current = currentComponent(site);
  const products = component
    ? data.componentProducts.filter((p) => acceptsProduct(component.component_type, p.type))
    : data.implants;
  const productOptions = products.some((p) => p.id === currentProductId) || !currentProductId
    ? products
    : [...products, (component ? component.product : site.product)!];
  const lots = correctionLots(
    data.lots,
    productId,
    component ? component.stock_lot_id : site.stock_lot_id,
    component ? component.fitted_on : site.placed_on,
  );
  const latest = site.followups.filter((f) => !f.voided_at).at(-1);

  function chooseTarget(value: string) {
    setTarget(value);
    const c = stockComponents.find((x) => x.id === value);
    setProductId(c ? c.product!.id : (site.product?.id ?? ''));
    setLotId('');
  }

  return (
    <details className="rounded border border-gray-200 p-2 text-sm">
      <summary className="cursor-pointer font-medium">Corrections</summary>
      <div className="mt-3 space-y-4">
        {site.product && (
          <div className="space-y-2">
            <label className="block">
              <span className="label">What to correct</span>
              <select className="input" value={target} onChange={(e) => chooseTarget(e.target.value)}>
                <option value="implant">The implant</option>
                {stockComponents.map((c) => (
                  <option key={c.id} value={c.id}>
                    {COMPONENT_LABELS[c.component_type]} ({formatDate(c.fitted_on)})
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">Product actually used</span>
              <select className="input" value={productId} onChange={(e) => { setProductId(e.target.value); setLotId(''); }}>
                {productOptions.map((p) => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">Correct batch</span>
              <select className="input" value={lotId} onChange={(e) => setLotId(e.target.value)}>
                <option value="">Choose the batch actually used…</option>
                {lots.map((l) => <option key={l.stock_lot_id} value={l.stock_lot_id}>{lotLabel(l)}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">Reason for correction</span>
              <input className="input" value={batchReason} onChange={(e) => setBatchReason(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn-secondary btn"
              disabled={pending}
              onClick={() =>
                run(() =>
                  correctBatch({
                    siteId: site.id,
                    patientId,
                    componentId: component?.id ?? '',
                    newProductId: productId !== currentProductId ? productId : '',
                    newLotId: lotId,
                    reason: batchReason,
                  }),
                )
              }
            >
              Correct batch
            </button>
          </div>
        )}
        {current && site.state !== 'failed' && (
          <div className="space-y-2">
            <p>Current component: {COMPONENT_LABELS[current.component_type]} ({formatDate(current.fitted_on)})</p>
            <label className="block">
              <span className="label">Reason for undoing the component</span>
              <input className="input" value={componentReason} onChange={(e) => setComponentReason(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn-secondary btn"
              disabled={pending}
              onClick={() => run(() => voidComponent({ id: current.id, patientId, reason: componentReason }))}
            >
              Undo current component
            </button>
          </div>
        )}
        {latest && (
          <div className="space-y-2">
            <p>
              Latest follow-up: {formatDate(latest.date)} · {latest.check_type} · {OUTCOME_LABELS[latest.outcome]}
            </p>
            <label className="block">
              <span className="label">Reason for removing the follow-up</span>
              <input className="input" value={followupReason} onChange={(e) => setFollowupReason(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn-secondary btn"
              disabled={pending}
              onClick={() => run(() => voidFollowup({ id: latest.id, patientId, reason: followupReason }))}
            >
              Remove follow-up
            </button>
          </div>
        )}
        {error && <p role="alert" className="text-red-700">{error}</p>}
        {ok && <p role="status" className="text-green-800">{ok}</p>}
      </div>
    </details>
  );
}

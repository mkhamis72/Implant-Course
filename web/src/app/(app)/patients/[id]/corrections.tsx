'use client';

import { useState, useTransition } from 'react';
import { acceptsProduct, currentComponent } from '@/lib/inventory/components';
import { lotLabel, productLabel } from '@/lib/inventory/labels';
import { COMPONENT_LABELS, OUTCOME_LABELS, type ChartData, type ImplantSite, type LotOnHand } from '@/lib/inventory/types';
import { formatDate } from '@/lib/format';
import { BONE_TYPES } from '@/lib/inventory/schemas';
import { correctBatch, correctPlacement, voidComponent, voidFollowup } from './implant-actions';

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

type Option = { id: string; label: string };

/** The active options, plus the one already recorded if it has since become inactive. */
function withRecorded(options: Option[], id: string | null, name: string | null | undefined): Option[] {
  if (!id || options.some((o) => o.id === id)) return options;
  return [...options, { id, label: `${name ?? 'Unknown'} (inactive)` }];
}

/** Date, people and clinical values of a placed implant, prefilled from what was recorded. */
function PlacementDetails({ patientId, site, data, run, pending }: {
  patientId: string; site: ImplantSite; data: ChartData; run: (fn: () => Promise<Result>) => void; pending: boolean;
}) {
  const [v, setV] = useState({
    placedOn: site.placed_on ?? '',
    placingDelegateId: site.placing_delegate_id ?? '',
    assistingDelegateId: site.assisting_delegate_id ?? '',
    supervisorId: site.supervisor_id ?? '',
    torque: site.torque_ncm?.toString() ?? '',
    isq: site.isq?.toString() ?? '',
    boneType: site.bone_type ?? '',
    graft: site.graft ?? '',
    notes: site.notes ?? '',
  });
  const set = (key: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV((cur) => ({ ...cur, [key]: e.target.value }));
  const delegates = withRecorded(
    withRecorded(data.delegates, site.placing_delegate_id, site.placing?.full_name),
    site.assisting_delegate_id,
    site.assisting?.full_name,
  );
  const supervisors = withRecorded(data.supervisors, site.supervisor_id, site.supervisor?.full_name);
  return (
    <div className="space-y-2" role="group" aria-label="Placement details">
      <p className="font-medium">Placement details</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="label">Placement date</span>
          <input className="input" type="date" value={v.placedOn} onChange={set('placedOn')} />
        </label>
        <label className="block">
          <span className="label">Placed by</span>
          <select className="input" value={v.placingDelegateId} onChange={set('placingDelegateId')}>
            <option value="">Choose the delegate…</option>
            {delegates.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">Assisted by</span>
          <select className="input" value={v.assistingDelegateId} onChange={set('assistingDelegateId')}>
            <option value="">Nobody</option>
            {delegates.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">Supervisor</span>
          <select className="input" value={v.supervisorId} onChange={set('supervisorId')}>
            <option value="">Choose the supervisor…</option>
            {supervisors.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">Insertion torque (Ncm)</span>
          <input className="input" inputMode="decimal" value={v.torque} onChange={set('torque')} />
        </label>
        <label className="block">
          <span className="label">ISQ</span>
          <input className="input" inputMode="decimal" value={v.isq} onChange={set('isq')} />
        </label>
        <label className="block">
          <span className="label">Bone type</span>
          <select className="input" value={v.boneType} onChange={set('boneType')}>
            <option value="">—</option>
            {BONE_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">Graft</span>
          <input className="input" value={v.graft} onChange={set('graft')} />
        </label>
      </div>
      <label className="block">
        <span className="label">Notes</span>
        <input className="input" value={v.notes} onChange={set('notes')} />
      </label>
      <button
        type="button"
        className="btn-secondary btn"
        disabled={pending}
        onClick={() => run(() => correctPlacement({ siteId: site.id, patientId, ...v }))}
      >
        Save details
      </button>
    </div>
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
    <details className="rounded border border-line p-2 text-sm">
      <summary className="cursor-pointer font-medium">Corrections</summary>
      <div className="mt-3 space-y-4">
        <PlacementDetails patientId={patientId} site={site} data={data} run={run} pending={pending} />
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
        {error && <p role="alert" className="text-bad">{error}</p>}
        {ok && <p role="status" className="text-ok">{ok}</p>}
      </div>
    </details>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { availableLots } from '@/lib/inventory/lots';
import { lotLabel } from '@/lib/inventory/labels';
import { currentComponent } from '@/lib/inventory/components';
import { COMPONENT_LABELS, OUTCOME_LABELS, type ChartData, type ImplantSite } from '@/lib/inventory/types';
import { formatDate } from '@/lib/format';
import { correctBatch, voidComponent, voidFollowup } from './implant-actions';

type Result = { error?: string };

function useRun() {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, after?: () => void) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else after?.();
    });
  };
  return { error, pending, run };
}

export function Corrections({ patientId, site, data }: { patientId: string; site: ImplantSite; data: ChartData }) {
  const { error, pending, run } = useRun();
  const [lotId, setLotId] = useState('');
  const [batchReason, setBatchReason] = useState('');
  const [followupReason, setFollowupReason] = useState('');
  const [componentReason, setComponentReason] = useState('');
  const current = currentComponent(site);
  const lots = site.product ? availableLots(data.lots, site.product.id, data.today).filter((l) => l.lot_no !== site.lot?.lot_no) : [];
  const followups = site.followups.filter((f) => !f.voided_at);
  const latest = followups.at(-1);

  return (
    <details className="rounded border border-gray-200 p-2 text-sm">
      <summary className="cursor-pointer font-medium">Corrections</summary>
      <div className="mt-3 space-y-4">
        {site.product && site.state !== 'failed' && (
          <div className="space-y-2">
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
              onClick={() => run(() => correctBatch({ siteId: site.id, patientId, newLotId: lotId, reason: batchReason }))}
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
      </div>
    </details>
  );
}

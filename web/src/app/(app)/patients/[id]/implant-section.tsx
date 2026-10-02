'use client';

import { useState, useTransition } from 'react';
import { activeSite, currentComponent } from '@/lib/inventory/components';
import { productLabel } from '@/lib/inventory/labels';
import { COMPONENT_LABELS, OUTCOME_LABELS, SITE_STATE_LABELS, type ChartData, type ImplantSite } from '@/lib/inventory/types';
import { isManualState, type ToothState } from '@/lib/patients/types';
import { formatDate, formatDateTime } from '@/lib/format';
import { cancelPlan } from './implant-actions';
import { Corrections } from './corrections';
import { ComponentForm, FollowupForm, PlaceForm, PlanForm } from './implant-forms';

type Mode = 'none' | 'plan' | 'place' | 'component' | 'followup';

function SiteDetails({ site, patientId, data }: { site: ImplantSite; patientId: string; data: ChartData }) {
  const current = currentComponent(site);
  const rows: [string, string][] = [
    ['State', SITE_STATE_LABELS[site.state]],
    ['Implant', site.product ? productLabel(site.product) : '—'],
    ['Batch', site.lot ? (site.lot.lot_no ? `Lot ${site.lot.lot_no}` : 'No lot') : '—'],
    ['Placed on', site.placed_on ? formatDate(site.placed_on) : '—'],
    ['Torque', site.torque_ncm !== null ? `${site.torque_ncm} Ncm` : '—'],
    ['Graft', site.graft || '—'],
    ['Placed by', site.placing?.full_name ?? '—'],
    ['Assisted by', site.assisting?.full_name ?? '—'],
    ['Supervisor', site.supervisor?.full_name || site.supervisor?.email || '—'],
    ['Current component', current ? COMPONENT_LABELS[current.component_type] : '—'],
  ];
  return (
    <div data-testid="site-details" className="space-y-3 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {site.components.length > 0 && (
        <div>
          <h4 className="font-medium">Components</h4>
          <ol className="list-decimal pl-5" data-testid="component-history">
            {site.components.map((c) => (
              <li key={c.id} className={c.voided_at ? 'text-subtle line-through' : ''}>
                {COMPONENT_LABELS[c.component_type]} — {formatDate(c.fitted_on)}
                {c.voided_at ? ` — undone: ${c.voided_reason}` : c.removed_on ? ` (until ${formatDate(c.removed_on)})` : ' (current)'}
              </li>
            ))}
          </ol>
        </div>
      )}
      {site.followups.length > 0 && (
        <div>
          <h4 className="font-medium">Follow-ups</h4>
          <ul data-testid="followups">
            {site.followups.map((f) => (
              <li key={f.id} className={f.voided_at ? 'text-subtle line-through' : ''}>
                {formatDate(f.date)} · {f.check_type} · {OUTCOME_LABELS[f.outcome]}
                {f.notes ? ` — ${f.notes}` : ''}
                {f.voided_at ? ` — removed: ${f.voided_reason}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      {site.state !== 'planned' && site.state !== 'removed' && <Corrections patientId={patientId} site={site} data={data} />}
    </div>
  );
}

export function ImplantSection({ patientId, tooth, status, data }: { patientId: string; tooth: number; status: ToothState; data: ChartData }) {
  const [mode, setMode] = useState<Mode>('none');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const site = activeSite(data.sites, tooth);
  const earlier = data.sites.filter((s) => s.tooth === tooth && s !== site && s.state !== 'removed');
  const canStart = !site && (isManualState(status) || status === 'failed');
  const done = () => setMode('none');

  function cancel() {
    if (!site) return;
    setError(null);
    start(async () => {
      const result = await cancelPlan({ patientId, siteId: site.id });
      if (result.error) setError(result.error);
    });
  }

  return (
    <section aria-label="Implant record" className="space-y-3 border-t border-line pt-4">
      <h3 className="font-semibold">Implant</h3>
      {!site && <p className="text-sm text-muted">No implant on this tooth.</p>}
      {site?.state === 'planned' && (
        <p className="text-sm">
          Planned{site.product ? `: ${productLabel(site.product)}` : ' (implant not chosen yet)'}
        </p>
      )}
      {site?.state === 'planned' && site.slot && (
        <p className="text-sm text-ink">
          Booked: {formatDateTime(site.slot.starts_at)}
          {site.slot.chair ? ` · ${site.slot.chair.name}` : ''}
        </p>
      )}
      {site && site.state !== 'planned' && <SiteDetails site={site} patientId={patientId} data={data} />}

      {mode === 'none' && (
        <div className="flex flex-wrap gap-2">
          {canStart && (
            <>
              <button className="btn-secondary btn" onClick={() => setMode('plan')}>Plan implant</button>
              <button className="btn" onClick={() => setMode('place')}>Place implant</button>
            </>
          )}
          {site?.state === 'planned' && (
            <>
              <button className="btn" onClick={() => setMode('place')}>Place implant</button>
              <button className="btn-secondary btn" disabled={pending} onClick={cancel}>Cancel plan</button>
            </>
          )}
          {site && (site.state === 'placed' || site.state === 'restored') && (
            <>
              <button className="btn-secondary btn" onClick={() => setMode('component')}>Add component</button>
              <button className="btn-secondary btn" onClick={() => setMode('followup')}>Add follow-up</button>
            </>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}

      {mode === 'plan' && <PlanForm patientId={patientId} tooth={tooth} data={data} onDone={done} />}
      {mode === 'place' && (
        <PlaceForm patientId={patientId} tooth={tooth} data={data} onDone={done} plannedProductId={site?.product?.id ?? null} slot={site?.slot ?? null} />
      )}
      {mode === 'component' && site && <ComponentForm patientId={patientId} site={site} data={data} onDone={done} />}
      {mode === 'followup' && site && <FollowupForm patientId={patientId} site={site} data={data} onDone={done} />}

      {earlier.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-ink">Earlier implants on this tooth ({earlier.length})</summary>
          <div className="mt-2 space-y-4">
            {earlier.map((s) => <SiteDetails key={s.id} site={s} patientId={patientId} data={data} />)}
          </div>
        </details>
      )}
    </section>
  );
}

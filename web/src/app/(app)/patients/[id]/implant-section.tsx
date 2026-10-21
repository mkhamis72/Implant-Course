'use client';

import { useState, useTransition } from 'react';
import { activeSite } from '@/lib/inventory/components';
import { productLabel } from '@/lib/inventory/labels';
import type { ChartData } from '@/lib/inventory/types';
import { nextActions, type PanelAction } from '@/lib/patients/tooth-panel';
import { initialTab, type ImplantTabKey } from '@/lib/patients/implant-tabs';
import { isManualState, type ToothState } from '@/lib/patients/types';
import { formatDateTime } from '@/lib/format';
import { cancelPlan } from './implant-actions';
import { ComponentForm, PlaceForm, PlanForm } from './implant-forms';
import { RecordVisitForm } from './visits';
import { ImplantTabs } from './implant-tabs';
import { SiteDetails, TechniqueControl } from './site-details';

type Mode = 'none' | 'plan' | 'place' | 'component' | 'followup';

const ACTION_LABELS: Record<Exclude<PanelAction, 'cancel'>, string> = {
  plan: 'Plan implant', place: 'Place implant', component: 'Add component', followup: 'Record visit',
};

export function ImplantSection({ patientId, tooth, status, data, openTab }: {
  patientId: string; tooth: number; status: ToothState; data: ChartData;
  /** The tab to open with, e.g. the Restoration tab when a restoration on the chart was clicked. */
  openTab?: ImplantTabKey;
}) {
  const [mode, setMode] = useState<Mode>('none');
  const [tab, setTab] = useState<ImplantTabKey>(openTab ?? initialTab(false));
  const [justPlaced, setJustPlaced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const site = activeSite(data.sites, tooth);
  const earlier = data.sites.filter((s) => s.tooth === tooth && s !== site && s.state !== 'removed');
  const canStart = !site && (isManualState(status) || status === 'failed');
  const actions = nextActions({ canStart, siteState: site?.state ?? null });
  const done = () => setMode('none');
  // An action shows the tab it adds to, so the new record appears in view.
  function begin(action: Exclude<PanelAction, 'cancel'>) {
    setMode(action);
    if (action === 'followup') setTab('visits');
    if (action === 'component') setTab('implant');
  }

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
      {site?.state === 'planned' && <TechniqueControl site={site} patientId={patientId} editable={data.editable} />}
      {site?.state === 'planned' && site.slot && (
        <p className="text-sm text-ink">
          Booked: {formatDateTime(site.slot.starts_at)}
          {site.slot.chair ? ` · ${site.slot.chair.name}` : ''}
        </p>
      )}

      {data.editable && mode === 'none' && actions.primary && (
        // One obvious next step per state; the alternatives stay quiet beside it.
        <div className="flex flex-wrap gap-2">
          {[actions.primary, ...actions.secondary].map((a, i) =>
            a === 'cancel' ? (
              <button key={a} className="btn-secondary btn" disabled={pending} onClick={cancel}>Cancel plan</button>
            ) : (
              <button key={a} className={i === 0 ? 'btn flex-1 sm:flex-none' : 'btn-secondary btn'} onClick={() => begin(a)}>
                {ACTION_LABELS[a]}
              </button>
            ),
          )}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}

      {mode === 'plan' && <PlanForm patientId={patientId} tooth={tooth} data={data} onDone={done} />}
      {mode === 'place' && (
        <PlaceForm patientId={patientId} tooth={tooth} data={data} onDone={done} plannedProductId={site?.product?.id ?? null}
          plannedTechnique={site?.technique ?? null} slot={site?.slot ?? null} onPlaced={() => { setJustPlaced(true); setTab(initialTab(true)); }} />
      )}
      {mode === 'component' && site && <ComponentForm patientId={patientId} site={site} data={data} onDone={done} />}
      {mode === 'followup' && site && <RecordVisitForm patientId={patientId} site={site} data={data} onDone={done} />}

      {/* The next step stays above the tabs, whichever tab is open. */}
      {site && site.state !== 'planned' && (
        <ImplantTabs key={site.id} site={site} patientId={patientId} data={data} justPlaced={justPlaced} selected={tab} onSelect={setTab} />
      )}

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

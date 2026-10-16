'use client';

import { useState, useTransition } from 'react';
import { activeSite, currentComponent } from '@/lib/inventory/components';
import { productLabel } from '@/lib/inventory/labels';
import {
  COMPONENT_LABELS, OUTCOME_LABELS, SITE_STATE_LABELS, TECHNIQUES, TECHNIQUE_LABELS,
  type ChartData, type ComponentType, type ImplantSite,
} from '@/lib/inventory/types';
import { nextActions, type PanelAction } from '@/lib/patients/tooth-panel';
import { isManualState, type ToothState } from '@/lib/patients/types';
import { formatDate, formatDateTime } from '@/lib/format';
import { cancelPlan, setTechnique } from './implant-actions';
import { Corrections } from './corrections';
import { SurgicalDetails } from './surgical-details';
import { ComponentForm, FollowupForm, PlaceForm, PlanForm } from './implant-forms';

type Mode = 'none' | 'plan' | 'place' | 'component' | 'followup';

const ACTION_LABELS: Record<Exclude<PanelAction, 'cancel'>, string> = {
  plan: 'Plan implant', place: 'Place implant', component: 'Add component', followup: 'Add follow-up',
};

// The restorative sequence on an implant; the connection stage covers Ti-base, multi-unit or abutment.
const STAGES: { label: string; types: ComponentType[] }[] = [
  { label: 'Cover screw', types: ['cover_screw'] },
  { label: 'Healing abutment', types: ['healing_abutment'] },
  { label: 'Abutment', types: ['ti_base', 'multi_unit', 'abutment'] },
  { label: 'Crown', types: ['final_restoration'] },
];

function ComponentTimeline({ site }: { site: ImplantSite }) {
  const current = currentComponent(site)?.component_type;
  const fitted = new Set(site.components.filter((c) => !c.voided_at).map((c) => c.component_type));
  return (
    <ol aria-label="Components so far" className="flex flex-wrap items-center gap-x-1 gap-y-1.5 text-xs">
      {STAGES.map((stage, i) => {
        const isCurrent = current !== undefined && stage.types.includes(current);
        const reached = stage.types.some((t) => fitted.has(t));
        return (
          <li key={stage.label} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden="true" className={`h-px w-3 ${reached ? 'bg-accent' : 'bg-line-strong'}`} />}
            <span
              aria-current={isCurrent ? 'step' : undefined}
              className={`whitespace-nowrap rounded-full px-2 py-0.5 ${
                isCurrent ? 'bg-accent font-semibold text-white' : reached ? 'bg-accent-soft text-accent-strong' : 'border border-line text-muted'
              }`}
            >
              {isCurrent && current ? COMPONENT_LABELS[current] : stage.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Shows the technique and lets it be set or corrected in place. */
function TechniqueControl({ site, patientId, editable }: { site: ImplantSite; patientId: string; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function choose(technique: string) {
    setError(null);
    start(async () => {
      const result = await setTechnique({ patientId, siteId: site.id, technique });
      if (result.error) setError(result.error);
      else setEditing(false);
    });
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="technique">
      <span className="text-muted">Technique:</span>
      {editing ? (
        <select
          className="input w-auto py-1"
          aria-label="Technique"
          defaultValue={site.technique ?? ''}
          disabled={pending}
          onChange={(e) => e.target.value && choose(e.target.value)}
        >
          <option value="">Choose…</option>
          {TECHNIQUES.map((t) => <option key={t} value={t}>{TECHNIQUE_LABELS[t]}</option>)}
        </select>
      ) : (
        <>
          <span className={`badge ${site.technique === 'guided' ? 'badge-guided' : site.technique ? 'badge-accent' : ''}`}>
            {site.technique ? TECHNIQUE_LABELS[site.technique] : 'Not set'}
          </span>
          {editable && (
            <button type="button" className="text-accent hover:underline" onClick={() => setEditing(true)}>
              {site.technique ? 'Change' : 'Set'}
            </button>
          )}
        </>
      )}
      {error && <p role="alert" className="w-full text-bad">{error}</p>}
    </div>
  );
}

function SiteDetails({ site, patientId, data, justPlaced = false }: { site: ImplantSite; patientId: string; data: ChartData; justPlaced?: boolean }) {
  const facts = [
    site.lot ? (site.lot.lot_no ? `Lot ${site.lot.lot_no}` : 'No lot') : null,
    site.placed_on ? formatDate(site.placed_on) : null,
    site.torque_ncm !== null ? `${site.torque_ncm} Ncm` : null,
    site.isq !== null && site.isq !== undefined ? `ISQ ${site.isq}` : null,
    site.bone_type ? `Bone ${site.bone_type}` : null,
    site.graft ? `Graft (old note): ${site.graft}` : null,
  ].filter(Boolean) as string[];
  const people = [
    site.placing?.full_name ? `Placed by ${site.placing.full_name}` : null,
    site.assisting?.full_name ? `assisted by ${site.assisting.full_name}` : null,
    site.supervisor ? `supervised by ${site.supervisor.full_name}` : null,
  ].filter(Boolean) as string[];
  return (
    <div data-testid="site-details" className="space-y-3 text-sm">
      <div className="space-y-2 rounded-lg border border-line bg-sunken px-3 py-2.5">
        <p className="font-semibold text-ink">
          {site.product ? productLabel(site.product) : 'Implant'}
          <span className="sr-only"> — {SITE_STATE_LABELS[site.state]}</span>
        </p>
        {facts.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {facts.map((f) => <li key={f} className="badge">{f}</li>)}
          </ul>
        )}
        {people.length > 0 && <p className="text-muted">{people.join(', ')}</p>}
        {site.state !== 'removed' && <TechniqueControl site={site} patientId={patientId} editable={data.editable} />}
        {(site.state === 'placed' || site.state === 'restored') && <ComponentTimeline site={site} />}
      </div>
      {site.state !== 'removed' && (
        <SurgicalDetails site={site} patientId={patientId} editable={data.editable} startOpen={justPlaced} />
      )}
      {site.components.length > 0 && (
        <div>
          <h4 className="font-medium">Component history</h4>
          <ol className="list-decimal pl-5 text-muted" data-testid="component-history">
            {site.components.map((c) => (
              <li key={c.id} className={c.voided_at ? 'text-muted line-through' : ''}>
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
              <li key={f.id} className={f.voided_at ? 'text-muted line-through' : ''}>
                {formatDate(f.date)} · {f.check_type} · {OUTCOME_LABELS[f.outcome]}
                {f.notes ? ` — ${f.notes}` : ''}
                {f.voided_at ? ` — removed: ${f.voided_reason}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.editable && site.state !== 'planned' && site.state !== 'removed' && <Corrections patientId={patientId} site={site} data={data} />}
    </div>
  );
}

export function ImplantSection({ patientId, tooth, status, data }: { patientId: string; tooth: number; status: ToothState; data: ChartData }) {
  const [mode, setMode] = useState<Mode>('none');
  const [justPlaced, setJustPlaced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const site = activeSite(data.sites, tooth);
  const earlier = data.sites.filter((s) => s.tooth === tooth && s !== site && s.state !== 'removed');
  const canStart = !site && (isManualState(status) || status === 'failed');
  const actions = nextActions({ canStart, siteState: site?.state ?? null });
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
      {site?.state === 'planned' && <TechniqueControl site={site} patientId={patientId} editable={data.editable} />}
      {site?.state === 'planned' && site.slot && (
        <p className="text-sm text-ink">
          Booked: {formatDateTime(site.slot.starts_at)}
          {site.slot.chair ? ` · ${site.slot.chair.name}` : ''}
        </p>
      )}
      {site && site.state !== 'planned' && <SiteDetails site={site} patientId={patientId} data={data} justPlaced={justPlaced} />}

      {data.editable && mode === 'none' && actions.primary && (
        // One obvious next step per state; the alternatives stay quiet beside it.
        <div className="flex flex-wrap gap-2">
          {[actions.primary, ...actions.secondary].map((a, i) =>
            a === 'cancel' ? (
              <button key={a} className="btn-secondary btn" disabled={pending} onClick={cancel}>Cancel plan</button>
            ) : (
              <button key={a} className={i === 0 ? 'btn flex-1 sm:flex-none' : 'btn-secondary btn'} onClick={() => setMode(a)}>
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
          plannedTechnique={site?.technique ?? null} slot={site?.slot ?? null} onPlaced={() => setJustPlaced(true)} />
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

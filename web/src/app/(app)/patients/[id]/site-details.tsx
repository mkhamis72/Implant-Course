'use client';

import { useState, useTransition } from 'react';
import { currentComponent } from '@/lib/inventory/components';
import { productLabel } from '@/lib/inventory/labels';
import {
  COMPONENT_LABELS, SITE_STATE_LABELS, TECHNIQUES, TECHNIQUE_LABELS,
  type ChartData, type ComponentType, type ImplantSite,
} from '@/lib/inventory/types';
import { formatDate } from '@/lib/format';
import { setTechnique } from './implant-actions';
import { Corrections } from './corrections';
import { SurgicalDetails } from './surgical-details';
import { Visits } from './visits';
import { Complications } from './complications';
import { FailureBox } from './failure-box';

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
export function TechniqueControl({ site, patientId, editable }: { site: ImplantSite; patientId: string; editable: boolean }) {
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

/** The implant itself: product, lot, measurements, people, technique, components and any failure. */
export function ImplantFacts({ site, patientId, data }: { site: ImplantSite; patientId: string; data: ChartData }) {
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
    <>
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
      <FailureBox site={site} patientId={patientId} editable={data.editable} />
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
    </>
  );
}

/** Whether a site can still be corrected from the panel. */
export const correctable = (site: ImplantSite, data: ChartData) => data.editable && site.state !== 'planned' && site.state !== 'removed';

/** Everything about one implant in a single column: used for earlier implants on the tooth. */
export function SiteDetails({ site, patientId, data }: { site: ImplantSite; patientId: string; data: ChartData }) {
  return (
    <div data-testid="site-details" className="space-y-3 text-sm">
      <ImplantFacts site={site} patientId={patientId} data={data} />
      {site.state !== 'removed' && <SurgicalDetails site={site} patientId={patientId} editable={data.editable} />}
      <Visits site={site} visits={data.visits} />
      <Complications site={site} patientId={patientId} editable={data.editable} />
      {correctable(site, data) && <Corrections patientId={patientId} site={site} data={data} />}
    </div>
  );
}

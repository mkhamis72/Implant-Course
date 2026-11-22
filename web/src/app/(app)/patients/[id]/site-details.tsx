'use client';

import { useState, useTransition } from 'react';
import { componentRole, currentComponents, partLabel } from '@/lib/inventory/components';
import { productLabel } from '@/lib/inventory/labels';
import { specsLine } from '@/lib/inventory/specs';
import { restorationLabel, type Restoration } from '@/lib/restorations/restorations';
import {
  COMPONENT_LABELS, SITE_STATE_LABELS, TECHNIQUES, TECHNIQUE_LABELS,
  type ChartData, type ImplantSite, type SiteComponent,
} from '@/lib/inventory/types';
import { formatDate } from '@/lib/format';
import { setTechnique } from './implant-actions';
import { Corrections } from './corrections';
import { SurgicalDetails } from './surgical-details';
import { Visits } from './visits';
import { Complications } from './complications';
import { FailureBox } from './failure-box';
import { ImpressionControl } from './impression-control';

/** What a screw holds (or a cap sits on), named: "Multi-unit abutment" or "Full arch 15–25 (final)". */
function holderOf(c: SiteComponent, site: ImplantSite, restorations: Restoration[]): string | null {
  if (c.holds_component_id) {
    const held = site.components.find((x) => x.id === c.holds_component_id);
    return held ? COMPONENT_LABELS[held.component_type] : 'an abutment';
  }
  if (c.holds_restoration_id) {
    const held = restorations.find((r) => r.id === c.holds_restoration_id);
    return held ? restorationLabel(held) : 'a restoration';
  }
  return null;
}

/** The parts on the implant now, one line each: healing or abutment, then its screws. */
function CurrentParts({ site, restorations }: { site: ImplantSite; restorations: Restoration[] }) {
  const parts = currentComponents(site);
  return (
    <div>
      <p className="text-muted">Current parts</p>
      {parts.length === 0 ? (
        <p className="text-muted">None recorded.</p>
      ) : (
        <ul aria-label="Current parts" className="space-y-1">
          {parts.map((c) => {
            const holder = holderOf(c, site, restorations);
            const specs = c.product ? specsLine(c.product) : '';
            return (
              <li key={c.id} data-testid="current-part">
                <span className="font-medium text-ink">{partLabel(c)}</span>
                {c.product && <span className="text-muted"> · {productLabel(c.product)}</span>}
                {c.torque_ncm !== null && <span> · Torque: {c.torque_ncm} Ncm</span>}
                {holder && <span> · {componentRole(c.component_type) === 'cap' ? 'on' : 'holds'} {holder}</span>}
                {specs && <span className="block text-xs text-muted">{specs}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
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
    !data.inventoryOn
      ? null
      : site.lot
        ? (site.lot.lot_no ? `Lot ${site.lot.lot_no}` : 'No lot')
        : !site.stock_lot_id && site.state !== 'planned' ? 'No stock batch recorded' : null,
    site.placed_on ? formatDate(site.placed_on) : null,
    site.torque_ncm !== null ? `${site.torque_ncm} Ncm` : null,
    site.isq !== null && site.isq !== undefined ? `ISQ ${site.isq}` : null,
    site.bone_type ? `Bone ${site.bone_type}` : null,
    site.graft ? `Graft (old note): ${site.graft}` : null,
  ].filter(Boolean) as string[];
  // A clinic (no Teaching) shows only the doctor, even where older records name delegates or a supervisor.
  const teaching = data.teachingOn;
  const people = [
    site.doctor?.name ? `Placed by ${site.doctor.name}` : teaching && site.placing?.full_name ? `Placed by ${site.placing.full_name}` : null,
    teaching && site.assisting?.full_name ? `assisted by ${site.assisting.full_name}` : null,
    teaching && site.supervisor ? `supervised by ${site.supervisor.full_name}` : null,
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
        {site.state !== 'planned' && site.state !== 'removed' && (
          <ImpressionControl site={site} patientId={patientId} editable={data.editable} />
        )}
        {(site.state === 'placed' || site.state === 'restored') && <CurrentParts site={site} restorations={data.restorations ?? []} />}
      </div>
      <FailureBox site={site} patientId={patientId} editable={data.editable} restorations={data.restorations} />
      {site.components.length > 0 && (
        <div>
          <h4 className="font-medium">Component history</h4>
          <ol className="list-decimal pl-5 text-muted" data-testid="component-history">
            {site.components.map((c) => (
              <li key={c.id} className={c.voided_at ? 'text-muted line-through' : ''}>
                {partLabel(c)}
                {data.teachingOn && c.course_id && ` — ${data.courses.find((x) => x.id === c.course_id)?.name ?? 'Unknown course'}`}
                {c.voided_at
                  ? ` — undone: ${c.voided_reason}`
                  : componentRole(c.component_type) === 'transfer' ? ''
                  : c.replaced_by && c.removed_on ? ` — replaced on ${formatDate(c.removed_on)}`
                  : c.removed_on ? ` (until ${formatDate(c.removed_on)})` : ' (current)'}
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

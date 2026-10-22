'use client';

import { useState } from 'react';
import type { ChartData, ImplantSite } from '@/lib/inventory/types';
import { RadiographForm, type XraySite } from './xrays/radiograph-form';
import { XrayCard } from './xrays/xray-list';

/** The X-rays that show this implant's tooth, newest first, with this implant's bone levels; editors can add one. */
export function ImplantXrays({ site, patientId, data }: { site: ImplantSite; patientId: string; data: ChartData }) {
  const [adding, setAdding] = useState(false);
  const shown = data.radiographs
    .filter((r) => r.teeth.includes(site.tooth))
    .sort((a, b) => (a.taken_on < b.taken_on ? 1 : a.taken_on > b.taken_on ? -1 : 0));
  const sites: XraySite[] = data.sites.map((s) => ({ id: s.id, tooth: s.tooth, state: s.state, placed_on: s.placed_on }));
  return (
    <div className="space-y-3">
      {data.editable && !adding && <button type="button" className="btn" onClick={() => setAdding(true)}>Add X-ray</button>}
      {adding && <RadiographForm patientId={patientId} sites={sites} prefillTeeth={[site.tooth]} onDone={() => setAdding(false)} />}
      {shown.length === 0 && !adding && <p className="text-sm text-muted">No X-rays recorded for this tooth.</p>}
      <ul className="space-y-3">
        {shown.map((r) => (
          <li key={r.id}><XrayCard r={r} patientId={patientId} sites={sites} editable={data.editable} onlySite={site.id} /></li>
        ))}
      </ul>
    </div>
  );
}

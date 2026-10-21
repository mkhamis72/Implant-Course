'use client';

import { useActionState, useState } from 'react';
import { todayIso } from '@/lib/dates';
import { IMPRESSION_LABELS, IMPRESSION_TYPES, NOT_TAKEN_LABEL, impressionSummary } from '@/lib/implants/impression';
import type { ImplantSite } from '@/lib/inventory/types';
import { valueOf, type FormState } from '@/lib/patients/form-state';
import { recordImpression } from './implant-actions';

/** Whether a digital scan or conventional impression was taken for this implant, and when. */
export function ImpressionControl({ site, patientId, editable }: { site: ImplantSite; patientId: string; editable: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(recordImpression, {});
  const [type, setType] = useState<string | null>(null);
  const current = type ?? valueOf(state, 'type', site.impression_type);
  return (
    <div className="space-y-1.5 text-sm" data-testid="impression">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">Scan / impression:</span>
        <span className={`badge ${site.impression_type ? 'badge-ok' : ''}`}>{impressionSummary(site)}</span>
      </div>
      {editable && (
        <form action={action} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="siteId" value={site.id} readOnly />
          <input type="hidden" name="patientId" value={patientId} readOnly />
          <input type="hidden" name="expectedUpdatedAt" value={site.updated_at} readOnly />
          <select
            key={`${site.updated_at}-${state.error ?? ''}`}
            className="input w-auto py-1"
            name="type"
            aria-label="Scan / impression"
            defaultValue={current}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">{NOT_TAKEN_LABEL}</option>
            {IMPRESSION_TYPES.map((t) => <option key={t} value={t}>{IMPRESSION_LABELS[t]}</option>)}
          </select>
          {current && (
            <label className="block">
              <span className="sr-only">Date taken</span>
              <input
                className="input w-auto py-1"
                name="takenOn"
                type="date"
                max={todayIso()}
                defaultValue={valueOf(state, 'takenOn', site.impression_taken_on ?? todayIso())}
              />
            </label>
          )}
          <button className="btn" disabled={pending}>Save</button>
        </form>
      )}
      {state.error && <p role="alert" className="text-bad">{state.error}</p>}
    </div>
  );
}

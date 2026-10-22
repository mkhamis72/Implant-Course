'use client';

import { useState } from 'react';
import type { ImplantSite } from '@/lib/inventory/types';
import type { Restoration } from '@/lib/restorations/restorations';
import { FAILURE_REASONS, FAILURE_REASON_LABELS, FAILURE_TYPES, FAILURE_TYPE_LABELS, describeFailure } from '@/lib/implants/failure';
import { Field, Footer, useSubmit } from './implant-forms';
import { saveFailure } from './outcome-actions';

export function FailureBox({ site, patientId, editable, restorations }: {
  site: ImplantSite; patientId: string; editable: boolean; restorations: readonly Restoration[];
}) {
  const [editing, setEditing] = useState(false);
  if (site.state !== 'failed') return null;
  const recorded = site.failure_type !== null;
  return (
    <div data-testid="failure" className="space-y-2 rounded-lg border border-line px-3 py-2.5">
      <h4 className="font-medium">Failure</h4>
      {editing ? (
        <FailureForm site={site} patientId={patientId} onDone={() => setEditing(false)} />
      ) : (
        <>
          <p className={recorded ? '' : 'text-muted'}>{recorded ? describeFailure(site, restorations.filter((r) => r.site_ids.includes(site.id))) : 'Failure details not recorded.'}</p>
          {site.failure_notes && <p className="text-muted">{site.failure_notes}</p>}
          {editable && (
            <button type="button" className="btn-secondary btn" onClick={() => setEditing(true)}>
              {recorded ? 'Edit failure details' : 'Add failure details'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function FailureForm({ site, patientId, onDone }: { site: ImplantSite; patientId: string; onDone: () => void }) {
  // Recording (no details yet) sends no version; correcting sends the version the form opened with.
  const [version] = useState(site.failure_type !== null ? site.updated_at : '');
  const [v, setV] = useState({
    failedOn: site.failed_on ?? '', failureType: site.failure_type ?? '', failureReason: site.failure_reason ?? '', failureNotes: site.failure_notes ?? '',
  });
  const set = (key: keyof typeof v) => (value: string) => setV((cur) => ({ ...cur, [key]: value }));
  const { error, pending, submit } = useSubmit(saveFailure, onDone);
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit({ siteId: site.id, patientId, expectedUpdatedAt: version, ...v }); }}>
      <FailureFields values={v} set={set} />
      <Footer error={error} pending={pending} saveLabel="Save failure details" onCancel={onDone} />
    </form>
  );
}

/** Failure date, type, reason and notes, shared with the Record visit form. */
export function FailureFields({ values, set }: {
  values: { failedOn: string; failureType: string; failureReason: string; failureNotes: string };
  set: (key: 'failedOn' | 'failureType' | 'failureReason' | 'failureNotes') => (value: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Failure date" required>
        <input className="input" type="date" aria-required="true" value={values.failedOn} onChange={(e) => set('failedOn')(e.target.value)} />
      </Field>
      <Field label="Failure type" required>
        <select className="input" aria-required="true" value={values.failureType} onChange={(e) => set('failureType')(e.target.value)}>
          <option value="">Choose…</option>
          {FAILURE_TYPES.map((t) => <option key={t} value={t}>{FAILURE_TYPE_LABELS[t]}</option>)}
        </select>
      </Field>
      <Field label="Failure reason" required>
        <select className="input" aria-required="true" value={values.failureReason} onChange={(e) => set('failureReason')(e.target.value)}>
          <option value="">Choose…</option>
          {FAILURE_REASONS.map((r) => <option key={r} value={r}>{FAILURE_REASON_LABELS[r]}</option>)}
        </select>
      </Field>
      <Field label="Failure notes">
        <input className="input" value={values.failureNotes} maxLength={1000} onChange={(e) => set('failureNotes')(e.target.value)} />
      </Field>
    </div>
  );
}

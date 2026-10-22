'use client';

import { useState, useTransition } from 'react';
import type { ImplantSite } from '@/lib/inventory/types';
import { formatDate } from '@/lib/format';
import {
  CASE_DEFINITIONS, CATEGORY_LABELS, COMPLICATION_CATEGORIES, IMPLANT_FORM_TYPES, SEVERITIES, SEVERITY_LABELS, TYPE_LABELS,
  describeComplication, isOpen, type ComplicationCategory, type ImplantComplication,
} from '@/lib/implants/complications';
import { Field, Footer, useSubmit } from './implant-forms';
import { saveComplication, voidComplication } from './outcome-actions';

// bare: inside the Complications tab, which names the section (no heading).
type Props = { site: ImplantSite; patientId: string; editable: boolean; bare?: boolean };

export function Complications({ site, patientId, editable, bare = false }: Props) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const live = (site.complications ?? []).filter((c) => !c.voided_at);
  const ordered = [...live.filter(isOpen), ...live.filter((c) => !isOpen(c))];
  return (
    <div data-testid="complications" className="space-y-2">
      {!bare && <h4 className="font-medium">Complications</h4>}
      {ordered.length === 0 && editing !== 'new' && <p className="text-muted">None recorded.</p>}
      <ul className="space-y-1">
        {ordered.map((c) => (
          <li key={c.id} className={isOpen(c) ? '' : 'text-muted'}>
            {editing === c.id ? (
              <ComplicationForm site={site} patientId={patientId} complication={c} onDone={() => setEditing(null)} />
            ) : (
              <ComplicationRow c={c} patientId={patientId} editable={editable} onEdit={() => setEditing(c.id)} />
            )}
          </li>
        ))}
      </ul>
      {editing === 'new' && <ComplicationForm site={site} patientId={patientId} complication={null} onDone={() => setEditing(null)} />}
      {editable && editing === null && (
        <button type="button" className="btn-secondary btn" onClick={() => setEditing('new')}>Add complication</button>
      )}
    </div>
  );
}

function ComplicationRow({ c, patientId, editable, onEdit }: { c: ImplantComplication; patientId: string; editable: boolean; onEdit: () => void }) {
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function remove() {
    setError(null);
    start(async () => {
      const result = await voidComplication({ patientId, complicationId: c.id, reason });
      if (result.error) setError(result.error);
    });
  }
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className={isOpen(c) ? 'badge badge-bad' : 'badge'}>{isOpen(c) ? 'Open' : 'Resolved'}</span>
        <span>{describeComplication(c)}</span>
        {editable && !removing && (
          <>
            <button type="button" className="btn-secondary btn" onClick={onEdit}>Edit complication</button>
            <button type="button" className="btn-secondary btn" onClick={() => setRemoving(true)}>Remove from record</button>
          </>
        )}
      </div>
      {removing && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="label">Reason for removing</span>
            <input className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button type="button" className="btn-danger btn" disabled={pending} onClick={remove}>Remove complication</button>
          <button type="button" className="btn-secondary btn" onClick={() => setRemoving(false)}>Keep</button>
        </div>
      )}
      {error && <p role="alert" className="text-bad">{error}</p>}
    </div>
  );
}

function ComplicationForm({ site, patientId, complication, onDone }: {
  site: ImplantSite; patientId: string; complication: ImplantComplication | null; onDone: () => void;
}) {
  // The version this form opened with, so a stale edit is refused rather than overwriting someone else's.
  const [version] = useState(complication?.updated_at ?? '');
  const visits = site.followups.filter((f) => !f.voided_at);
  // A linked visit that was voided later is no longer a valid link; start with none so the save is not refused.
  const linked = complication?.followup_id && visits.some((f) => f.id === complication.followup_id) ? complication.followup_id : '';
  const [v, setV] = useState({
    category: complication?.category ?? '', type: complication?.type ?? '', otherType: complication?.other_type ?? '',
    noticedOn: complication?.noticed_on ?? '', severity: complication?.severity ?? '', treatment: complication?.treatment ?? '',
    resolvedOn: complication?.resolved_on ?? '', followupId: linked, notes: complication?.notes ?? '',
  });
  const set = (key: keyof typeof v) => (value: string) =>
    setV((cur) => ({ ...cur, [key]: value, ...(key === 'category' ? { type: '', otherType: '' } : {}) }));
  const { error, pending, submit } = useSubmit(saveComplication, onDone);
  const offered = v.category ? IMPLANT_FORM_TYPES[v.category as ComplicationCategory] : [];
  // An older entry keeps its crown type choosable so editing it doesn't force a change.
  const types = v.type && v.category === complication?.category && !offered.includes(v.type) ? [...offered, v.type] : offered;
  return (
    <form className="space-y-3 rounded-lg border border-line p-3" onSubmit={(e) => {
      e.preventDefault();
      submit({ complicationId: complication?.id ?? '', expectedUpdatedAt: version, siteId: site.id, patientId, ...v });
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Category" required>
          <select className="input" aria-required="true" value={v.category} onChange={(e) => set('category')(e.target.value)}>
            <option value="">Choose…</option>
            {COMPLICATION_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
        </Field>
        <Field label="Type" required>
          <select className="input" aria-required="true" value={v.type} onChange={(e) => set('type')(e.target.value)} disabled={!v.category}>
            <option value="">Choose…</option>
            {types.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
        </Field>
      </div>
      {CASE_DEFINITIONS[v.type] && <p className="text-sm text-muted">{CASE_DEFINITIONS[v.type]}</p>}
      {v.type === 'other' && (
        <Field label="Describe">
          <input className="input" value={v.otherType} maxLength={120} onChange={(e) => set('otherType')(e.target.value)} />
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Noticed on" required>
          <input className="input" type="date" aria-required="true" value={v.noticedOn} onChange={(e) => set('noticedOn')(e.target.value)} />
        </Field>
        <Field label="Severity">
          <select className="input" value={v.severity} onChange={(e) => set('severity')(e.target.value)}>
            <option value="">— not recorded</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>)}
          </select>
        </Field>
        <Field label="Resolved on">
          <input className="input" type="date" value={v.resolvedOn} onChange={(e) => set('resolvedOn')(e.target.value)} />
        </Field>
        <Field label="Found at visit">
          <select className="input" value={v.followupId} onChange={(e) => set('followupId')(e.target.value)}>
            <option value="">—</option>
            {visits.map((f) => <option key={f.id} value={f.id}>{formatDate(f.date)} · {f.check_type}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Treatment">
        <input className="input" value={v.treatment} maxLength={1000} onChange={(e) => set('treatment')(e.target.value)} />
      </Field>
      <Field label="Notes">
        <input className="input" value={v.notes} maxLength={1000} onChange={(e) => set('notes')(e.target.value)} />
      </Field>
      <Footer error={error} pending={pending} saveLabel="Save complication" onCancel={onDone} />
    </form>
  );
}

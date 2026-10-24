'use client';

import { useState } from 'react';
import { FOLLOWUP_OUTCOMES, OUTCOME_LABELS, type ChartData, type ImplantSite } from '@/lib/inventory/types';
import { formatDate } from '@/lib/format';
import { YES_NO } from '@/lib/patients/risk-factors';
import {
  ATTENDANCE, ATTENDANCE_LABELS, PROBING_SITES, PROSTHESIS_LABELS, PROSTHESIS_STATUSES, VISIT_STATUS_BADGE, VISIT_STATUS_LABELS,
  prepickVisit, recordableVisits, summarizeFindings, visitResult, type VisitRow,
} from '@/lib/visits/visits';
import { Field, Footer, useSubmit } from './implant-forms';
import { FailureFields } from './failure-box';
import { recordVisit } from './visit-actions';

const YES_NO_LABELS = { yes: 'Yes', no: 'No' } as const;

export function Visits({ site, visits }: { site: ImplantSite; visits: VisitRow[] }) {
  const schedule = visits.filter((v) => v.site_id === site.id);
  const doneDate = (v: VisitRow) => (v.followup_id ? site.followups.find((f) => f.id === v.followup_id)?.date : undefined) ?? v.target_date;
  return (
    <div className="space-y-3">
      {schedule.length > 0 && (
        <div>
          <h4 className="font-medium">Visits</h4>
          <ol data-testid="visit-schedule" className="space-y-1">
            {schedule.map((v) => (
              <li key={v.visit_key} data-testid="visit-row" className="flex flex-wrap items-center gap-x-2">
                <span>{v.label}</span>
                <span className="text-muted">{formatDate(doneDate(v))}</span>
                <span className={VISIT_STATUS_BADGE[v.status]}>{VISIT_STATUS_LABELS[v.status]}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {site.followups.length > 0 && (
        <div>
          <h4 className="font-medium">Visit records</h4>
          <ul data-testid="visit-records">
            {site.followups.map((f) => {
              const findings = summarizeFindings(f);
              return (
                <li key={f.id} className={f.voided_at ? 'text-muted line-through' : ''}>
                  {formatDate(f.date)} · {f.check_type} · {visitResult(f)}
                  {findings ? ` — ${findings}` : ''}
                  {f.notes ? ` — ${f.notes}` : ''}
                  {f.voided_at ? ` — removed: ${f.voided_reason}` : ''}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

const BLANK = {
  painScore: '', patientConcerns: '', swelling: '', suppuration: '', plaque: '', mobility: '',
  probingMesial: '', probingBuccal: '', probingDistal: '', probingLingual: '',
  bopMesial: '', bopBuccal: '', bopDistal: '', bopLingual: '',
  isq: '', prosthesisStatus: '', radiographTaken: '', recommendedTreatment: '',
  failedOn: '', failureType: '', failureReason: '', failureNotes: '',
};

export function RecordVisitForm({ patientId, site, data, onDone }: {
  patientId: string; site: ImplantSite; data: ChartData; onDone: () => void;
}) {
  const options = recordableVisits(data.visits, site.id);
  const [v, setV] = useState({
    visitKey: prepickVisit(data.visits, site.id), checkType: '', date: data.today, attendance: 'attended', outcome: '', notes: '', ...BLANK,
  });
  const set = (key: keyof typeof v) => (value: string) => setV((cur) => ({ ...cur, [key]: value }));
  const { error, pending, submit } = useSubmit(recordVisit, onDone);
  const attended = v.attendance === 'attended';
  const needsFailure = attended && v.outcome === 'failed' && site.state !== 'failed';
  const yesNo = (key: 'swelling' | 'suppuration' | 'plaque' | 'mobility' | 'radiographTaken', label: string) => (
    <Field label={label}>
      <select className="input" value={v[key]} onChange={(e) => set(key)(e.target.value)}>
        <option value="">—</option>
        {YES_NO.map((o) => <option key={o} value={o}>{YES_NO_LABELS[o]}</option>)}
      </select>
    </Field>
  );
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit({ patientId, siteId: site.id, ...v, failedOn: needsFailure ? v.failedOn || v.date : '', needsFailure: needsFailure ? '1' : '' }); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Visit">
          <select className="input" value={v.visitKey} onChange={(e) => set('visitKey')(e.target.value)}>
            {options.map((o) => (
              <option key={o.visit_key} value={o.visit_key}>
                {o.label} · {formatDate(o.target_date)} · {VISIT_STATUS_LABELS[o.status]}
              </option>
            ))}
            <option value="">Unscheduled visit</option>
          </select>
        </Field>
        {v.visitKey === '' && (
          <Field label="Visit for">
            <input className="input" value={v.checkType} maxLength={60} onChange={(e) => set('checkType')(e.target.value)} />
          </Field>
        )}
        <Field label="Date">
          <input className="input" type="date" min={site.placed_on ?? undefined} max={data.today} value={v.date} onChange={(e) => set('date')(e.target.value)} />
        </Field>
      </div>
      <div role="radiogroup" aria-label="Attendance" className="flex flex-wrap gap-x-4 gap-y-1">
        {ATTENDANCE.map((a) => (
          <label key={a} className="flex items-center gap-1.5 text-sm">
            <input type="radio" name={`attendance-${site.id}`} value={a} checked={v.attendance === a} onChange={() => set('attendance')(a)} />
            {ATTENDANCE_LABELS[a]}
          </label>
        ))}
      </div>
      {attended && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Outcome">
              <select className="input" value={v.outcome} onChange={(e) => set('outcome')(e.target.value)}>
                <option value="">Choose…</option>
                {FOLLOWUP_OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>)}
              </select>
            </Field>
            <Field label="Pain (0–10)">
              <input className="input" inputMode="numeric" value={v.painScore} onChange={(e) => set('painScore')(e.target.value)} />
            </Field>
            {yesNo('swelling', 'Swelling')}
            {yesNo('suppuration', 'Suppuration')}
            {yesNo('plaque', 'Plaque')}
            {yesNo('mobility', 'Mobility')}
          </div>
          {needsFailure && (
            <FailureFields values={{ ...v, failedOn: v.failedOn || v.date }} set={(k) => set(k)} placedOn={site.placed_on} maxOn={v.date || data.today} />
          )}
          <fieldset>
            <legend className="label">Probing depth (mm) and bleeding</legend>
            <div className="grid grid-cols-4 gap-2">
              {PROBING_SITES.map((s) => {
                const depthKey = s.depthField;
                const bopKey = s.bopField;
                return (
                  <div key={s.key} className="space-y-1 text-center">
                    <span className="text-sm font-medium" aria-hidden="true">{s.short}</span>
                    <input className="input text-center" inputMode="decimal" aria-label={`Probing depth ${s.label}`}
                      value={v[depthKey]} onChange={(e) => set(depthKey)(e.target.value)} />
                    <label className="flex items-center justify-center gap-1 text-xs">
                      <input type="checkbox" aria-label={`Bleeding ${s.label}`} checked={v[bopKey] === 'yes'}
                        onChange={(e) => set(bopKey)(e.target.checked ? 'yes' : '')} />
                      <span aria-hidden="true">BOP</span>
                    </label>
                  </div>
                );
              })}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="ISQ">
              <input className="input" inputMode="decimal" value={v.isq} onChange={(e) => set('isq')(e.target.value)} />
            </Field>
            <Field label="Prosthesis">
              <select className="input" value={v.prosthesisStatus} onChange={(e) => set('prosthesisStatus')(e.target.value)}>
                <option value="">—</option>
                {PROSTHESIS_STATUSES.map((p) => <option key={p} value={p}>{PROSTHESIS_LABELS[p]}</option>)}
              </select>
            </Field>
            {yesNo('radiographTaken', 'Radiograph taken')}
            <Field label="Patient concerns">
              <input className="input" value={v.patientConcerns} maxLength={1000} onChange={(e) => set('patientConcerns')(e.target.value)} />
            </Field>
          </div>
          <Field label="Recommended treatment">
            <input className="input" value={v.recommendedTreatment} maxLength={1000} onChange={(e) => set('recommendedTreatment')(e.target.value)} />
          </Field>
        </>
      )}
      <Field label={v.attendance === 'not_needed' ? 'Reason' : 'Notes'}>
        <input className="input" value={v.notes} maxLength={1000} onChange={(e) => set('notes')(e.target.value)} />
      </Field>
      <Footer error={error} pending={pending} saveLabel="Save visit" onCancel={onDone} />
    </form>
  );
}

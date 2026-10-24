'use client';

import { todayIso } from '@/lib/dates';
import { useActionState, useState } from 'react';
import type { MedicalHistory } from '@/lib/patients/types';
import { RISK_QUESTIONS, notAssessedCount } from '@/lib/patients/risk-factors';
import { valueOf, type FormState } from '@/lib/patients/form-state';
import { saveMedicalHistory } from './actions';

const TEXTS: { key: keyof MedicalHistory; label: string }[] = [
  { key: 'allergies', label: 'Allergies' },
  { key: 'medications', label: 'Medications' },
  { key: 'other_conditions', label: 'Other conditions' },
  { key: 'notes', label: 'Notes' },
];

const str = (v: string | number | null) => (v === null ? '' : String(v));

export function MedicalHistoryForm({ history }: { history: MedicalHistory }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveMedicalHistory, {});
  // React resets the form after each action and radios fall back to their initial choice; remounting on every
  // result rebuilds them from the submitted (or saved) values. See schedule/_talks/talk-form.tsx.
  const [seen, setSeen] = useState(state);
  const [attempt, setAttempt] = useState(0);
  if (state !== seen) {
    setSeen(state);
    setAttempt(attempt + 1);
  }
  return (
    <form key={attempt} action={action} className="card max-w-2xl space-y-4">
      <h2 className="font-semibold">Medical history</h2>
      <input type="hidden" name="patient_id" value={history.patient_id} readOnly />
      <input type="hidden" name="expected_updated_at" value={history.updated_at} readOnly />
      <RiskFactors history={history} state={state} />
      {TEXTS.map(({ key, label }) => (
        <label key={key} className="block">
          <span className="label">{label}</span>
          <textarea className="input" name={key} rows={2} defaultValue={valueOf(state, key, history[key] as string)} />
        </label>
      ))}
      <p className="text-sm text-muted">{notAssessedCount(history)} of {RISK_QUESTIONS.length} not assessed</p>
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      {state.ok && <p className="text-sm text-ok">{state.ok}</p>}
      <button className="btn" disabled={pending}>
        Save medical history
      </button>
    </form>
  );
}

function RiskFactors({ history, state }: { history: MedicalHistory; state: FormState }) {
  const [smoking, setSmoking] = useState(valueOf(state, 'smoking', history.smoking));
  return (
    <div className="space-y-3">
      <p className="label">Conditions relevant to implants</p>
      {RISK_QUESTIONS.map((q) => {
        const current = valueOf(state, q.key, history[q.key]);
        return (
          <div key={q.key} role="radiogroup" aria-label={q.label} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
            <span className="text-sm font-medium sm:w-52">{q.label}</span>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {q.options.map((o) => (
                <label key={o.value} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio" name={q.key} value={o.value} defaultChecked={current === o.value}
                    onChange={q.key === 'smoking' ? () => setSmoking(o.value) : undefined}
                  />
                  {o.label}
                </label>
              ))}
            </div>
          </div>
        );
      })}
      {smoking === 'current' && (
        <label className="block max-w-48">
          <span className="label">Cigarettes per day</span>
          <input className="input" name="cigarettes_per_day" inputMode="numeric"
            defaultValue={valueOf(state, 'cigarettes_per_day', str(history.cigarettes_per_day))} />
        </label>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">HbA1c (%)</span>
          <input className="input" name="hba1c" inputMode="decimal" defaultValue={valueOf(state, 'hba1c', str(history.hba1c))} />
        </label>
        <label className="block">
          <span className="label">HbA1c date</span>
          <input className="input" type="date" name="hba1c_date" max={todayIso()} defaultValue={valueOf(state, 'hba1c_date', history.hba1c_date)} />
        </label>
      </div>
    </div>
  );
}

'use client';

import { useActionState } from 'react';
import type { MedicalHistory } from '@/lib/patients/types';
import { checkedOf, valueOf, type FormState } from '@/lib/patients/form-state';
import { saveMedicalHistory } from './actions';

const FLAGS: { key: keyof MedicalHistory; label: string }[] = [
  { key: 'bisphosphonates', label: 'Bisphosphonates' },
  { key: 'anticoagulants', label: 'Anticoagulants' },
  { key: 'radiotherapy_head_neck', label: 'Head/neck radiotherapy' },
  { key: 'diabetes', label: 'Diabetes' },
  { key: 'osteoporosis', label: 'Osteoporosis' },
  { key: 'smoker', label: 'Smoker' },
];

const TEXTS: { key: keyof MedicalHistory; label: string }[] = [
  { key: 'allergies', label: 'Allergies' },
  { key: 'medications', label: 'Medications' },
  { key: 'other_conditions', label: 'Other conditions' },
  { key: 'notes', label: 'Notes' },
];

export function MedicalHistoryForm({ history }: { history: MedicalHistory }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveMedicalHistory, {});
  return (
    <form action={action} className="card max-w-2xl space-y-4">
      <h2 className="font-semibold">Medical history</h2>
      <input type="hidden" name="patient_id" value={history.patient_id} readOnly />
      <input type="hidden" name="expected_updated_at" value={history.updated_at} readOnly />
      <fieldset className="grid gap-2 sm:grid-cols-3">
        <legend className="label">Conditions relevant to implants</legend>
        {FLAGS.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name={key} defaultChecked={checkedOf(state, key, history[key] as boolean)} />
            {label}
          </label>
        ))}
      </fieldset>
      {TEXTS.map(({ key, label }) => (
        <label key={key} className="block">
          <span className="label">{label}</span>
          <textarea className="input" name={key} rows={2} defaultValue={valueOf(state, key, history[key] as string)} />
        </label>
      ))}
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      {state.ok && <p className="text-sm text-green-800">{state.ok}</p>}
      <button className="btn" disabled={pending}>
        Save medical history
      </button>
    </form>
  );
}

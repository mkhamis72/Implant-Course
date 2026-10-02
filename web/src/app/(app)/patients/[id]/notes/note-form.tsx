'use client';

import { useActionState } from 'react';
import { valueOf, type FormState } from '@/lib/patients/form-state';
import { addNote } from './actions';

export function NoteForm({ patientId, today }: { patientId: string; today: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addNote, {});
  return (
    <form action={action} className="card max-w-2xl space-y-4">
      <h2 className="font-semibold">Add a note</h2>
      <input type="hidden" name="patient_id" value={patientId} readOnly />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Visit date</span>
          <input className="input" name="visit_date" type="date" defaultValue={valueOf(state, 'visit_date', today)} />
        </label>
        <label className="block">
          <span className="label">Teeth (optional)</span>
          <input className="input" name="teeth" placeholder="e.g. 36, 46" defaultValue={valueOf(state, 'teeth', '')} />
        </label>
      </div>
      <label className="block">
        <span className="label">Note</span>
        <textarea className="input" name="text" rows={4} defaultValue={valueOf(state, 'text', '')} />
      </label>
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      <button className="btn" disabled={pending}>
        Add note
      </button>
    </form>
  );
}

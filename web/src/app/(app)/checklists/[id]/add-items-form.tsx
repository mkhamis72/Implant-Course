'use client';

import { useActionState } from 'react';
import { valueOf, type FormState } from '@/lib/patients/form-state';
import { addItems } from '../actions';

export function AddItemsForm({ checklistId }: { checklistId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addItems, {});
  return (
    <form action={action} className="card space-y-2" key={state.ok}>
      <input type="hidden" name="checklist_id" value={checklistId} readOnly />
      <label className="block">
        <span className="label">Add items (one per line)</span>
        <textarea className="input font-mono text-sm" name="items" rows={3} defaultValue={valueOf(state, 'items', '')} />
      </label>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      <button className="btn-secondary btn" disabled={pending}>Add items</button>
    </form>
  );
}

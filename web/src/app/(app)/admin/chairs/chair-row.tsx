'use client';

import { useActionState } from 'react';
import type { Chair } from '@/lib/schedule/types';
import type { FormState } from '@/lib/patients/form-state';
import { addChair, updateChair } from './actions';

export function ChairRow({ chair }: { chair: Chair }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateChair, {});
  return (
    <li data-testid={`chair-row-${chair.name}`} className="border-t border-gray-200 py-2">
      <form action={action} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="id" value={chair.id} readOnly />
        <input className="input max-w-xs" name="name" aria-label="Name" defaultValue={chair.name} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={chair.active} />
          Active
        </label>
        <span className="text-sm text-gray-600">{chair.active ? 'Active' : 'Inactive'}</span>
        <button className="btn-secondary btn py-1" disabled={pending}>
          Save
        </button>
        {state.error && <span role="alert" className="text-sm text-red-700">{state.error}</span>}
      </form>
    </li>
  );
}

export function AddChair() {
  const [state, action, pending] = useActionState<FormState, FormData>(addChair, {});
  return (
    <form action={action} className="card flex flex-wrap items-end gap-3" key={state.ok}>
      <label className="block">
        <span className="label">New chair</span>
        <input className="input" name="name" placeholder="e.g. Chair 3" />
      </label>
      <button className="btn" disabled={pending}>
        Add chair
      </button>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
    </form>
  );
}

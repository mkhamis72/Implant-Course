'use client';

import { useActionState } from 'react';
import type { Lecturer } from '@/lib/schedule/types';
import type { FormState } from '@/lib/patients/form-state';
import { addLecturer, updateLecturer } from './actions';

export function LecturerRow({ lecturer }: { lecturer: Lecturer }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateLecturer, {});
  return (
    <li data-testid={`lecturer-row-${lecturer.full_name}`} className="border-t border-line py-2">
      <form action={action} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="id" value={lecturer.id} readOnly />
        <input className="input max-w-xs" name="full_name" aria-label="Name" defaultValue={lecturer.full_name} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={lecturer.active} />
          Active
        </label>
        <span className="text-sm text-muted">{lecturer.active ? 'Active' : 'Inactive'}</span>
        <button className="btn-secondary btn py-1" disabled={pending}>
          Save
        </button>
        {state.error && <span role="alert" className="text-sm text-bad">{state.error}</span>}
      </form>
    </li>
  );
}

export function AddLecturer() {
  const [state, action, pending] = useActionState<FormState, FormData>(addLecturer, {});
  return (
    <form action={action} className="card flex flex-wrap items-end gap-3" key={state.ok}>
      <label className="block">
        <span className="label">New lecturer</span>
        <input className="input" name="full_name" placeholder="e.g. Prof. Laila Samir" />
      </label>
      <button className="btn" disabled={pending}>
        Add lecturer
      </button>
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
    </form>
  );
}

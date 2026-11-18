'use client';

import { useActionState } from 'react';
import type { Doctor } from '@/lib/schedule/types';
import type { FormState } from '@/lib/patients/form-state';
import { addDoctor, updateDoctor } from './actions';

export function DoctorRow({ doctor }: { doctor: Doctor }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateDoctor, {});
  return (
    <li data-testid={`doctor-row-${doctor.name}`} className="border-t border-line py-2">
      <form action={action} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="id" value={doctor.id} readOnly />
        <input className="input max-w-xs" name="name" aria-label="Name" defaultValue={doctor.name} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={doctor.active} />
          Active
        </label>
        <span className="text-sm text-muted">{doctor.active ? 'Active' : 'Inactive'}</span>
        <button className="btn-secondary btn py-1" disabled={pending}>
          Save
        </button>
        {state.error && <span role="alert" className="text-sm text-bad">{state.error}</span>}
      </form>
    </li>
  );
}

export function AddDoctor() {
  const [state, action, pending] = useActionState<FormState, FormData>(addDoctor, {});
  return (
    <form action={action} className="card flex flex-wrap items-end gap-3" key={state.ok}>
      <label className="block">
        <span className="label">New doctor</span>
        <input className="input" name="name" placeholder="e.g. Dr. Amr Hassan" />
      </label>
      <button className="btn" disabled={pending}>
        Add doctor
      </button>
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
    </form>
  );
}

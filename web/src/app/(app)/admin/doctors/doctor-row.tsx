'use client';

import { useActionState } from 'react';
import type { Doctor } from '@/lib/schedule/types';
import type { FormState } from '@/lib/patients/form-state';
import { addDoctor, setDoctorLogin, updateDoctor } from './actions';

/** A staff login (admin or organizer) of this company. */
export type Login = { user_id: string; full_name: string; email: string };

/** The doctor's linked login with Unlink, or a choice of the free staff logins to link. */
function DoctorLogin({ doctor, login, logins }: { doctor: Doctor; login: Omit<Login, 'user_id'> | null; logins: Login[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setDoctorLogin, {});
  return (
    <form action={action} className="mt-2 flex flex-wrap items-center gap-3 text-sm">
      <input type="hidden" name="id" value={doctor.id} readOnly />
      {login ? (
        <>
          <input type="hidden" name="user_id" value="" readOnly />
          <span>Login: {login.full_name} ({login.email})</span>
          <button className="btn-secondary btn py-1" disabled={pending} aria-label={`Unlink the login of ${doctor.name}`}>
            Unlink
          </button>
        </>
      ) : (
        <>
          <span className="text-muted">No login</span>
          {logins.length > 0 && (
            <>
              <select className="input max-w-xs py-1" name="user_id" aria-label={`Login for ${doctor.name}`} defaultValue="" required>
                <option value="">Choose a login…</option>
                {logins.map((l) => <option key={l.user_id} value={l.user_id}>{l.full_name || l.email} ({l.email})</option>)}
              </select>
              <button className="btn-secondary btn py-1" disabled={pending}>
                Link login
              </button>
            </>
          )}
        </>
      )}
      {state.error && <span role="alert" className="text-bad">{state.error}</span>}
    </form>
  );
}

export function DoctorRow({ doctor, login, logins }: { doctor: Doctor; login: Omit<Login, 'user_id'> | null; logins: Login[] }) {
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
      <DoctorLogin doctor={doctor} login={login} logins={logins} />
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

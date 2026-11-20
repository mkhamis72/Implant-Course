'use client';

import { useActionState, useState } from 'react';
import { inviteUser } from './actions';
import type { ActionState } from '@/lib/admin/schemas';
import { TemporaryPassword } from '@/components/temporary-password';

/** A clinic links a Doctor's login to a doctor: a new one named after the user, or one without a login. */
function DoctorChoice({ doctors }: { doctors: { id: string; name: string }[] }) {
  return (
    <label className="block">
      <span className="label">Doctor</span>
      <select className="input" name="doctor" defaultValue="new">
        <option value="new">New doctor named after the user</option>
        {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
    </label>
  );
}

/**
 * Email on: sends an invitation that verifies the address. Email off: creates the login and shows a one-time password.
 * A clinic offers Admin and Doctor (organizer); a Doctor, or an Admin who is also a doctor, is linked to a doctor.
 */
export function InviteForm({ emailOn, clinic, doctors }: { emailOn: boolean; clinic: boolean; doctors: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(inviteUser, {});
  // React resets the form after each action; remounting the fields keeps the role and doctor controls in step.
  const [seen, setSeen] = useState(state);
  const [attempt, setAttempt] = useState(0);
  if (state !== seen) {
    setSeen(state);
    setAttempt(attempt + 1);
  }
  return (
    <form action={action} data-testid="invite-form" className="card grid gap-4 sm:grid-cols-4 sm:items-end">
      <label className="block">
        <span className="label">Full name</span>
        <input className="input" name="full_name" required />
      </label>
      <label className="block">
        <span className="label">Email</span>
        <input className="input" name="email" type="text" inputMode="email" required />
      </label>
      {clinic ? <ClinicRole key={attempt} doctors={doctors} /> : (
        <label className="block">
          <span className="label">Role</span>
          <select className="input" name="role" defaultValue="organizer">
            <option value="organizer">Organizer</option>
            <option value="admin">Admin</option>
          </select>
        </label>
      )}
      <button className="btn justify-center" disabled={pending}>
        {emailOn ? 'Send invite' : 'Create login'}
      </button>
      {state.error && <p role="alert" className="text-sm text-bad sm:col-span-4">{state.error}</p>}
      {state.ok && <p className="text-sm text-ok sm:col-span-4">{state.ok}</p>}
      {state.password && <TemporaryPassword password={state.password} className="sm:col-span-4" />}
    </form>
  );
}

function ClinicRole({ doctors }: { doctors: { id: string; name: string }[] }) {
  const [role, setRole] = useState<'admin' | 'organizer'>('organizer');
  const [alsoDoctor, setAlsoDoctor] = useState(false);
  return (
    <>
      <label className="block">
        <span className="label">Role</span>
        <select className="input" name="role" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'organizer')}>
          <option value="admin">Admin</option>
          <option value="organizer">Doctor</option>
        </select>
      </label>
      {role === 'admin' && (
        <label className="flex items-center gap-2 text-sm sm:pb-2">
          <input type="checkbox" name="also_doctor" checked={alsoDoctor} onChange={(e) => setAlsoDoctor(e.target.checked)} />
          Also a doctor
        </label>
      )}
      {(role === 'organizer' || alsoDoctor) && <DoctorChoice doctors={doctors} />}
    </>
  );
}

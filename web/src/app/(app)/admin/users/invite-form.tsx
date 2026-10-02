'use client';

import { useActionState } from 'react';
import { inviteUser } from './actions';
import type { ActionState } from '@/lib/admin/schemas';

export function InviteForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(inviteUser, {});
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
      <label className="block">
        <span className="label">Role</span>
        <select className="input" name="role" defaultValue="organizer">
          <option value="organizer">Organizer</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      <button className="btn justify-center" disabled={pending}>
        Send invite
      </button>
      {state.error && <p role="alert" className="text-sm text-bad sm:col-span-4">{state.error}</p>}
      {state.ok && <p className="text-sm text-ok sm:col-span-4">{state.ok}</p>}
    </form>
  );
}

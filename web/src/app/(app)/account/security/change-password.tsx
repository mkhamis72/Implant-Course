'use client';

import { useActionState } from 'react';
import { changeOwnPassword, type ChangePasswordState } from './actions';

/** Change the password with the current one. Works for everyone, email on or off. */
export function ChangePassword() {
  const [state, action, pending] = useActionState<ChangePasswordState, FormData>(changeOwnPassword, {});
  return (
    <form action={action} className="space-y-3">
      <label className="block">
        <span className="label">Current password</span>
        <input className="input" name="current" type="password" autoComplete="current-password" required />
      </label>
      <label className="block">
        <span className="label">New password</span>
        <input className="input" name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} />
      </label>
      <label className="block">
        <span className="label">Confirm new password</span>
        <input className="input" name="confirm" type="password" autoComplete="new-password" required />
      </label>
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm text-ok">{state.ok}</p>}
      <button className="btn" disabled={pending}>Change password</button>
    </form>
  );
}

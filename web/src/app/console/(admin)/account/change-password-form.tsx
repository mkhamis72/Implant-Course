'use client';

import { useActionState } from 'react';
import { changeConsolePassword, type ChangePasswordState } from './actions';

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<ChangePasswordState, FormData>(changeConsolePassword, {});
  return (
    <form action={action} className="card max-w-md space-y-4">
      <label className="block">
        <span className="label">New password</span>
        <input className="input" type="password" name="password" autoComplete="new-password" required />
      </label>
      <label className="block">
        <span className="label">Confirm new password</span>
        <input className="input" type="password" name="confirm" autoComplete="new-password" required />
      </label>
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm text-ok">{state.ok}</p>}
      <button className="btn" disabled={pending}>Change password</button>
    </form>
  );
}

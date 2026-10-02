'use client';

import { useActionState } from 'react';
import { setPassword, type SetPasswordState } from './actions';

export function SetPasswordForm() {
  const [state, action, pending] = useActionState<SetPasswordState, FormData>(setPassword, {});
  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className="label">New password</span>
        <input className="input" name="password" type="password" autoComplete="new-password" required minLength={10} />
      </label>
      <label className="block">
        <span className="label">Confirm password</span>
        <input className="input" name="confirm" type="password" autoComplete="new-password" required />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-bad">
          {state.error}
        </p>
      )}
      <button className="btn" disabled={pending}>
        Save password
      </button>
    </form>
  );
}

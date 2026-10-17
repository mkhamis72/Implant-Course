'use client';

import { useActionState } from 'react';
import { requestReset, type ForgotState } from './actions';

export function ForgotForm() {
  const [state, action, pending] = useActionState<ForgotState, FormData>(requestReset, {});
  if (state.sent) {
    return (
      <p role="status" className="rounded bg-ok-soft p-3 text-sm">
        {state.sent}
      </p>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className="label">Email</span>
        <input className="input" name="email" type="email" autoComplete="username" required defaultValue={state.email} />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-bad">
          {state.error}
        </p>
      )}
      <button className="btn w-full justify-center" disabled={pending}>
        Send reset link
      </button>
    </form>
  );
}

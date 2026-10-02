'use client';

import { useActionState } from 'react';
import { verifyMfa, type MfaState } from './actions';

export function MfaForm() {
  const [state, action, pending] = useActionState<MfaState, FormData>(verifyMfa, {});
  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className="label">Authentication code</span>
        <input className="input" name="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-bad">
          {state.error}
        </p>
      )}
      <button className="btn w-full justify-center" disabled={pending}>
        Verify
      </button>
    </form>
  );
}

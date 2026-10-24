'use client';

import { useActionState } from 'react';
import { finishMfaSetup } from './actions';

/** Shown to a user who must set up 2FA again but already has a verified authenticator. */
export function FinishSetup() {
  const [state, action, pending] = useActionState(async () => finishMfaSetup(), {} as { error?: string });
  return (
    <form action={action} className="space-y-2">
      <button className="btn" disabled={pending}>
        Finish set-up
      </button>
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
    </form>
  );
}

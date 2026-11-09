'use client';

import { useActionState } from 'react';
import { emailPasswordLink } from './actions';

type State = { sent?: string; error?: string };

/** Changing the password goes through the emailed reset link, so the same checks apply as on "Forgot password?". */
export function PasswordLink() {
  const [state, action, pending] = useActionState<State>(() => emailPasswordLink(), {});
  return (
    <form action={action} className="space-y-2">
      <p className="text-sm text-muted">We email a link to your address where you set a new password.</p>
      <button className="btn-secondary btn" disabled={pending}>
        Email me a link to change my password
      </button>
      {state.sent && <p role="status" className="text-sm text-ok">{state.sent}</p>}
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
    </form>
  );
}

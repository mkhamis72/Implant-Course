'use client';

import { useActionState } from 'react';
import { emailPasswordLink } from './actions';

type State = { sent?: string; error?: string };

/** "Forgot your password?": an emailed reset link, with the same checks as on the sign-in page. */
export function PasswordLink() {
  const [state, action, pending] = useActionState<State>(() => emailPasswordLink(), {});
  return (
    <form action={action} className="space-y-2">
      <h3 className="text-sm font-semibold">Forgot your password?</h3>
      <p className="text-sm text-muted">We email a link to your address where you set a new password.</p>
      <button className="btn-secondary btn" disabled={pending}>
        Email me a reset link
      </button>
      {state.sent && <p role="status" className="text-sm text-ok">{state.sent}</p>}
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
    </form>
  );
}

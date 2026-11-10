'use client';

import { useActionState } from 'react';
import { emailConsolePasswordLink } from './actions';

type State = { sent?: string; error?: string };

/** Changing the password goes through an emailed link, so the same checks apply as on the company sign-in page. */
export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<State>(() => emailConsolePasswordLink(), {});
  return (
    <form action={action} className="card max-w-md space-y-4">
      <p className="text-sm text-muted">We email a link to your address where you set a new password.</p>
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      {state.sent && <p role="status" className="text-sm text-ok">{state.sent}</p>}
      <button className="btn" disabled={pending}>Email me a link to change my password</button>
    </form>
  );
}

'use client';

import { useActionState } from 'react';
import { signInConsole, type ConsoleAuthState } from '../auth-actions';

export function ConsoleLoginForm() {
  const [state, action, pending] = useActionState<ConsoleAuthState, FormData>(signInConsole, {});
  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className="label">Email</span>
        <input className="input" name="email" type="email" autoComplete="username" defaultValue={state.email} required autoFocus />
      </label>
      <label className="block">
        <span className="label">Password</span>
        <input className="input" name="password" type="password" autoComplete="current-password" required />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-bad">
          {state.error}
        </p>
      )}
      <button className="btn w-full justify-center" disabled={pending}>
        Sign in
      </button>
    </form>
  );
}

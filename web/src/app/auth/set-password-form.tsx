'use client';

import { useActionState } from 'react';
import type { SetPasswordState } from '@/lib/auth/link-password';

/** The new-password form of the reset and invite pages; `action` is the page's own server action. */
export function SetPasswordForm({ action, token }: { action: (prev: SetPasswordState, formData: FormData) => Promise<SetPasswordState>; token: string }) {
  const [state, formAction, pending] = useActionState<SetPasswordState, FormData>(action, {});
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
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

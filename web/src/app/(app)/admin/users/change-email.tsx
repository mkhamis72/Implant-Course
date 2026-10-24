'use client';

import { useActionState, useEffect, useState } from 'react';
import type { ActionState } from '@/lib/admin/schemas';
import { changeEmail } from './actions';

/** Change email: opens an in-page confirmation that says what happens, then changes the sign-in address. */
export function ChangeEmail({ userId, email }: { userId: string; email: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(changeEmail, {});
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  if (!open) {
    return (
      <div>
        <button type="button" className="text-sm text-accent hover:underline" aria-label={`Change email of ${email}`} onClick={() => setOpen(true)}>
          Change email
        </button>
        {state.ok && <p className="text-sm text-ok">{state.ok}</p>}
        {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      </div>
    );
  }
  return (
    <form action={action} className="max-w-sm space-y-2 rounded bg-warn-soft p-3 text-sm">
      <input type="hidden" name="user_id" value={userId} />
      <label className="block">
        <span className="label">New email</span>
        <input className="input py-1" name="email" type="email" maxLength={120} required autoComplete="off" />
      </label>
      <p>
        They will be signed out everywhere and must sign in with the new address. A notice goes to the new address (and to {email}{' '}
        if they have signed in before).
      </p>
      <div className="flex gap-2">
        <button className="btn py-1" disabled={pending}>Change email</button>
        <button type="button" className="btn-secondary btn py-1" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {state.error && <p role="alert" className="text-bad">{state.error}</p>}
    </form>
  );
}

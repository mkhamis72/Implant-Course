'use client';

import { useActionState, useEffect, useState } from 'react';
import type { ActionState } from '@/lib/admin/schemas';
import { resetGoogle } from './actions';

/**
 * Reset Google sign-in, behind an in-page confirmation. Offered only while the account has a linked Google identity
 * (`available`); it stays mounted after a reset so its result is still shown once the link is gone.
 */
export function ResetGoogle({ userId, email, available }: { userId: string; email: string; available: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(resetGoogle, {});
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  if (!open || !available) {
    if (!available && !state.ok && !state.error) return null;
    return (
      <div>
        {available && (
          <button type="button" className="btn-secondary btn py-1" aria-label={`Reset Google sign-in for ${email}`} onClick={() => setOpen(true)}>
            Reset Google sign-in
          </button>
        )}
        {state.ok && <p className="mt-1 text-sm text-ok">{state.ok}</p>}
        {state.error && <p role="alert" className="mt-1 text-sm text-bad">{state.error}</p>}
      </div>
    );
  }
  return (
    <form action={action} className="max-w-sm space-y-2 rounded bg-warn-soft p-3 text-sm">
      <input type="hidden" name="user_id" value={userId} />
      <p>Their link to a Google account is removed. The next Google account they sign in with is remembered instead.</p>
      <div className="flex gap-2">
        <button className="btn btn-danger py-1" disabled={pending}>Reset Google sign-in</button>
        <button type="button" className="btn-secondary btn py-1" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {state.error && <p role="alert" className="text-bad">{state.error}</p>}
    </form>
  );
}

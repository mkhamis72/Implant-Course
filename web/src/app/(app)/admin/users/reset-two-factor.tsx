'use client';

import { useActionState, useEffect, useState } from 'react';
import type { ActionState } from '@/lib/admin/schemas';
import { resetTwoFactor } from './actions';

/**
 * Reset 2FA, behind an in-page confirmation. Offered only while the user has a verified factor (`available`); it stays
 * mounted after a reset so its result is still shown once the factor is gone.
 */
export function ResetTwoFactor({ userId, email, available }: { userId: string; email: string; available: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(resetTwoFactor, {});
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  if (!open || !available) {
    if (!available && !state.ok && !state.error) return null;
    return (
      <div>
        {available && (
          <button type="button" className="btn-secondary btn py-1" aria-label={`Reset 2FA for ${email}`} onClick={() => setOpen(true)}>
            Reset 2FA
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
      <p>
        Their authenticator is removed and they will be signed out everywhere. At their next sign-in they must set up two-factor
        authentication again before they can use the app.
      </p>
      <div className="flex gap-2">
        <button className="btn btn-danger py-1" disabled={pending}>Reset 2FA</button>
        <button type="button" className="btn-secondary btn py-1" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {state.error && <p role="alert" className="text-bad">{state.error}</p>}
    </form>
  );
}

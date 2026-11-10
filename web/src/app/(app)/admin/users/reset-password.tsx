'use client';

import { useActionState } from 'react';
import type { ActionState } from '@/lib/admin/schemas';
import { TemporaryPassword } from '@/components/temporary-password';
import { resetPassword } from './actions';

/**
 * Admin only, for a lost or never-received password. Email on: the user is emailed a link to set a new one (the admin never
 * sees it). Email off: a new one-time password is set and shown once.
 */
export function ResetPassword({ userId, label }: { userId: string; label?: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(resetPassword, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="user_id" value={userId} />
      <button className="btn-secondary btn py-1" disabled={pending} aria-label={label}>
        Reset password
      </button>
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      {state.ok && <p className="text-sm text-ok">{state.ok}</p>}
      {state.password && <TemporaryPassword password={state.password} />}
    </form>
  );
}

'use client';

import { useActionState } from 'react';
import type { ActionState } from '@/lib/admin/schemas';
import { TemporaryPassword } from '@/components/temporary-password';
import { resetPassword } from './actions';

/** Admin only: replaces a login's password with a new one-time password (for a lost or never-received one). */
export function ResetPassword({ userId, label }: { userId: string; label?: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(resetPassword, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="user_id" value={userId} />
      <button className="btn-secondary btn py-1" disabled={pending} aria-label={label}>
        Reset password
      </button>
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      {state.password && <TemporaryPassword password={state.password} />}
    </form>
  );
}

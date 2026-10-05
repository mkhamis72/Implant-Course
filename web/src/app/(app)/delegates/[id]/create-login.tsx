'use client';

import { useActionState } from 'react';
import type { ActionState } from '@/lib/admin/schemas';
import { createDelegateLogin } from '../actions';

/** Admin only: a login for this delegate (invitation with email on, one-time password with email off). */
export function CreateLogin({ delegateId, emailOn }: { delegateId: string; emailOn: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createDelegateLogin, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="delegate_id" value={delegateId} />
      <p className="text-sm text-muted">
        A delegate login sees only their own schedule and implant report.{' '}
        {emailOn ? 'They get an email to verify their address and set a password.' : 'You get a one-time password to hand over.'}
      </p>
      <button className="btn-secondary btn" disabled={pending}>
        Create login
      </button>
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      {state.ok && <p className="text-sm text-ok">{state.ok}</p>}
      {state.password && (
        <p data-testid="temporary-password" className="rounded-md bg-warn-soft p-3 text-sm">
          Temporary password: <code className="font-mono font-semibold">{state.password}</code> — hand it over in person; it is shown only once.
          They change it under Account security.
        </p>
      )}
    </form>
  );
}

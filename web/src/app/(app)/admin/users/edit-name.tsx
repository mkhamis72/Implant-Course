'use client';

import { useActionState, useEffect, useState } from 'react';
import type { ActionState } from '@/lib/admin/schemas';
import { editName } from './actions';

/** The user's name, with an in-place form to change it (your own included). */
export function EditName({ userId, name, isSelf }: { userId: string; name: string; isSelf: boolean }) {
  const [editing, setEditing] = useState(false);
  // React 19 resets the form after the action: keep what was typed (and remount the input) so an error doesn't lose it.
  const [state, action, pending] = useActionState<ActionState & { typed?: string; attempt?: number }, FormData>(
    async (prev, formData) => ({ ...(await editName(prev, formData)), typed: String(formData.get('full_name') ?? ''), attempt: (prev.attempt ?? 0) + 1 }),
    {},
  );
  useEffect(() => {
    if (state.ok) setEditing(false);
  }, [state]);

  if (!editing) {
    return (
      <div>
        {name || '—'} {isSelf && <span className="text-muted">(you)</span>}{' '}
        <button type="button" className="text-sm text-accent hover:underline" aria-label={`Edit name of ${name || 'user'}`} onClick={() => setEditing(true)}>
          Edit
        </button>
        {state.ok && <p className="text-sm text-ok">{state.ok}</p>}
      </div>
    );
  }
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="user_id" value={userId} />
      <label className="block">
        <span className="label">Name</span>
        <input key={state.attempt ?? 0} className="input py-1" name="full_name" defaultValue={state.error ? state.typed : name} maxLength={120} required />
      </label>
      <div className="flex gap-2">
        <button className="btn py-1" disabled={pending}>Save name</button>
        <button type="button" className="btn-secondary btn py-1" onClick={() => setEditing(false)}>Cancel</button>
      </div>
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
    </form>
  );
}

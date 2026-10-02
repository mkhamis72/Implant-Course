'use client';

import { useActionState, useState } from 'react';
import { deleteTemplate } from '../../actions';

export function DeleteTemplate({ id }: { id: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(deleteTemplate, {});
  if (!confirming) {
    return (
      <button type="button" className="text-sm text-red-700 hover:underline" onClick={() => setConfirming(true)}>
        Delete template
      </button>
    );
  }
  return (
    <form action={action} className="space-y-2 rounded bg-red-50 p-3 text-sm">
      <input type="hidden" name="id" value={id} />
      <p>Delete this template? Checklists already made from it are kept.</p>
      <div className="flex gap-2">
        <button className="btn bg-red-700 hover:bg-red-800" disabled={pending}>Yes, delete</button>
        <button type="button" className="btn-secondary btn" onClick={() => setConfirming(false)}>Cancel</button>
      </div>
      {state.error && <p role="alert" className="text-red-700">{state.error}</p>}
    </form>
  );
}

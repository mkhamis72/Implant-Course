'use client';

import { useActionState, useState } from 'react';
import type { FormState } from '@/lib/patients/form-state';

type Props = {
  id: string;
  /** What is deleted, e.g. "patient" or "course". */
  noun: string;
  /** The name the user must type to confirm. */
  name: string;
  /** What else goes with it, shown in the confirmation. */
  consequences: string;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  /** Accessible name of the opening button, when several share a page (e.g. one per list row). */
  triggerLabel?: string;
  triggerClassName?: string;
  panelClassName?: string;
};

/** Two-step delete: open the panel, type the exact name, then delete. */
export function ConfirmDelete({
  id, noun, name, consequences, action: serverAction, triggerLabel, triggerClassName = '', panelClassName = '',
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [state, action, pending] = useActionState(serverAction, {});
  if (!confirming) {
    return (
      <button
        type="button"
        className={`text-sm text-bad hover:underline ${triggerClassName}`}
        aria-label={triggerLabel}
        onClick={() => setConfirming(true)}
      >
        Delete {noun}
      </button>
    );
  }
  const matches = typed.trim() === name.trim();
  return (
    <form action={action} className={`max-w-xl space-y-2 rounded bg-bad-soft p-3 text-sm ${panelClassName}`}>
      <input type="hidden" name="id" value={id} />
      <p className="font-medium">Delete this {noun} permanently?</p>
      <p>{consequences} This cannot be undone.</p>
      <label className="block">
        <span className="label">Type <strong>{name}</strong> to confirm</span>
        <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      </label>
      <div className="flex gap-2">
        <button className="btn btn-danger" disabled={pending || !matches}>Delete {noun}</button>
        <button type="button" className="btn-secondary btn" onClick={() => { setConfirming(false); setTyped(''); }}>Cancel</button>
      </div>
      {state.error && <p role="alert" className="text-bad">{state.error}</p>}
    </form>
  );
}

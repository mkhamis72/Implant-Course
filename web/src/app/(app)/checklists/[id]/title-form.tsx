'use client';

import { useActionState } from 'react';
import type { FormState } from '@/lib/patients/form-state';
import { renameChecklist } from '../actions';

export function TitleForm({ id, title }: { id: string; title: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(renameChecklist, {});
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted">Rename</summary>
      <form action={action} className="mt-2 flex flex-wrap gap-2">
        <input type="hidden" name="id" value={id} readOnly />
        <input className="input max-w-md" name="title" aria-label="Checklist title" defaultValue={title} />
        <button className="btn-secondary btn" disabled={pending}>Save title</button>
        {state.error && <p role="alert" className="text-bad">{state.error}</p>}
      </form>
    </details>
  );
}

'use client';

import { useActionState } from 'react';
import type { Option } from '@/lib/inventory/types';
import { valueOf, type FormState } from '@/lib/patients/form-state';
import { createChecklist } from './actions';

export function NewChecklistForm({ templates }: { templates: Option[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createChecklist, {});
  return (
    <form action={action} className="card space-y-3">
      <h2 className="font-semibold">New checklist</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Title</span>
          <input className="input" name="title" defaultValue={valueOf(state, 'title', '')} />
        </label>
        <label className="block">
          <span className="label">Start from template (optional)</span>
          <select className="input" name="template_id" defaultValue={valueOf(state, 'template_id', '')}>
            <option value="">No template</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="label">Items (one per line)</span>
        <textarea className="input font-mono text-sm" name="items" rows={5} defaultValue={valueOf(state, 'items', '')} />
      </label>
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}
      <button className="btn" disabled={pending}>Create checklist</button>
    </form>
  );
}

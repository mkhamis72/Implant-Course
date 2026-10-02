'use client';

import { useActionState, useState } from 'react';
import { SCOPE_LABELS } from '@/lib/checklists/format';
import { SCOPES, type ChecklistScope, type Template } from '@/lib/checklists/types';
import { checkedOf, valueOf, type FormState } from '@/lib/patients/form-state';
import { saveTemplate } from '../actions';

export function TemplateForm({ template }: { template?: Template }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveTemplate, {});
  const itemsText = template ? template.items.map((i) => i.text).join('\n') : '';
  // General checklists are never attached automatically, so they have no "default" option.
  const [scope, setScope] = useState(valueOf(state, 'applies_to', template?.applies_to ?? 'general') as ChecklistScope);
  return (
    <form action={action} className="card max-w-3xl space-y-4">
      {template && <input type="hidden" name="id" value={template.id} readOnly />}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Template name</span>
          <input className="input" name="name" defaultValue={valueOf(state, 'name', template?.name ?? '')} />
        </label>
        <label className="block">
          <span className="label">Used for</span>
          {/* Uncontrolled, so React's form reset after saving keeps the saved choice; state only drives the checkbox. */}
          <select
            className="input"
            name="applies_to"
            defaultValue={valueOf(state, 'applies_to', template?.applies_to ?? 'general')}
            onChange={(e) => setScope(e.target.value as ChecklistScope)}
          >
            {SCOPES.map((s) => <option key={s} value={s}>{SCOPE_LABELS[s]}</option>)}
          </select>
        </label>
      </div>
      {scope !== 'general' && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="is_default" defaultChecked={checkedOf(state, 'is_default', template?.is_default ?? false)} />
          Attach automatically to every new session / booking of this kind
        </label>
      )}
      <label className="block">
        <span className="label">Items (one per line)</span>
        <textarea className="input font-mono text-sm" name="items" rows={10} defaultValue={valueOf(state, 'items', itemsText)} />
      </label>
      <p className="text-xs text-gray-500">Paste a list: bullets, numbers and [ ] boxes are removed automatically.</p>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      {state.ok && <p className="text-sm text-green-800">{state.ok}</p>}
      <button className="btn" disabled={pending}>Save template</button>
    </form>
  );
}

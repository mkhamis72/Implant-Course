'use client';

import { useOptimistic, useState, useTransition } from 'react';
import { doneLabel } from '@/lib/checklists/format';
import type { ChecklistItem } from '@/lib/checklists/types';
import type { Option } from '@/lib/inventory/types';
import { formatDate } from '@/lib/format';
import { deleteItem, editItem, moveItem, toggleItem } from '../actions';

export function ItemRow({ item, checklistId, organizers, first, last }: {
  item: ChecklistItem; checklistId: string; organizers: Option[]; first: boolean; last: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const [assignee, setAssignee] = useState(item.assignee_id ?? '');
  const [due, setDue] = useState(item.due_date ?? '');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const savedDone = Boolean(item.done_at);
  // Show the tick immediately; it falls back to the saved state if the server refuses.
  const [done, setDone] = useOptimistic(savedDone);
  const who = item.done_by_profile?.full_name || item.done_by_profile?.email || 'someone';

  const run = (fn: () => Promise<{ error?: string; warning?: string }>, after?: () => void) => {
    setError(null);
    setWarning(null);
    start(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else {
        if (r.warning) setWarning(r.warning);
        after?.();
      }
    });
  };

  return (
    <li data-testid="checklist-item" className="space-y-1 border-t border-line py-3 first:border-t-0">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <input
          type="checkbox"
          className="mt-0.5 h-6 w-6 shrink-0"
          aria-label={item.text}
          checked={done}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.checked;
            setError(null);
            start(async () => {
              setDone(next);
              const r = await toggleItem({ id: item.id, checklistId, done: next });
              if (r.error) setError(r.error);
            });
          }}
        />
        <div className="min-w-0 flex-1">
          <p className={done ? 'text-muted line-through' : ''}>{item.text}</p>
          <p className="text-xs text-muted">
            {savedDone && done && item.done_at && <span className="mr-3 text-ok">{doneLabel(who, item.done_at)}</span>}
            {item.assignee && <span className="mr-3">→ {item.assignee.full_name || item.assignee.email}</span>}
            {item.due_date && <span>due {formatDate(item.due_date)}</span>}
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-1 pl-9 text-xs sm:w-auto sm:pl-0">
          <button className="btn-secondary btn px-2 py-0.5" disabled={first || pending} onClick={() => run(() => moveItem({ id: item.id, checklistId, direction: -1 }))}>
            Move up
          </button>
          <button className="btn-secondary btn px-2 py-0.5" disabled={last || pending} onClick={() => run(() => moveItem({ id: item.id, checklistId, direction: 1 }))}>
            Move down
          </button>
          <button
            className="btn-secondary btn px-2 py-0.5"
            onClick={() => {
              // Start from the latest saved values: someone else may have changed them since this row first rendered.
              if (!editing) {
                setText(item.text);
                setAssignee(item.assignee_id ?? '');
                setDue(item.due_date ?? '');
              }
              setEditing((e) => !e);
            }}
          >
            Edit
          </button>
          <button className="btn-secondary btn px-2 py-0.5 text-bad" disabled={pending} onClick={() => run(() => deleteItem({ id: item.id, checklistId }))}>
            Delete
          </button>
        </div>
      </div>
      {editing && (
        <form
          className="ml-9 grid gap-2 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => editItem({ id: item.id, checklistId, text, assignee_id: assignee, due_date: due }), () => setEditing(false));
          }}
        >
          <label className="block sm:col-span-2">
            <span className="sr-only">Item text</span>
            <input className="input py-1" aria-label="Item text" value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <select className="input py-1" aria-label="Assigned to" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Nobody</option>
            {item.assignee_id && item.assignee && !organizers.some((o) => o.id === item.assignee_id) && (
              <option value={item.assignee_id}>{item.assignee.full_name || item.assignee.email} (inactive)</option>
            )}
            {organizers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <input className="input py-1" type="date" aria-label="Due date" value={due} onChange={(e) => setDue(e.target.value)} />
          <button className="btn py-1 sm:col-span-4 sm:w-24" disabled={pending}>Save</button>
        </form>
      )}
      {error && <p role="alert" className="ml-9 text-sm text-bad">{error}</p>}
      {warning && <p role="status" className="ml-9 text-sm text-warn">{warning}</p>}
    </li>
  );
}

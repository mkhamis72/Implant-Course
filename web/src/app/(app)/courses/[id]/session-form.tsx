'use client';

import { useActionState } from 'react';
import { SESSION_TYPES, SESSION_TYPE_LABELS } from '@/lib/schedule/types';
import { valueOf, type FormState } from '@/lib/patients/form-state';
import type { Option } from '@/lib/inventory/types';
import { addSession } from '../actions';

export function SessionForm({ courseId, defaultDate, organizers }: { courseId: string; defaultDate: string; organizers: Option[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addSession, {});
  return (
    <form action={action} className="card grid gap-4 sm:grid-cols-3" key={state.ok}>
      <input type="hidden" name="course_id" value={courseId} readOnly />
      <label className="block sm:col-span-2">
        <span className="label">Session title</span>
        <input className="input" name="title" defaultValue={valueOf(state, 'title', '')} />
      </label>
      <label className="block">
        <span className="label">Session type</span>
        <select className="input" name="type" defaultValue={valueOf(state, 'type', 'surgery')}>
          {SESSION_TYPES.map((t) => <option key={t} value={t}>{SESSION_TYPE_LABELS[t]}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="label">Session date</span>
        <input className="input" type="date" name="date" defaultValue={valueOf(state, 'date', defaultDate)} />
      </label>
      <label className="block">
        <span className="label">Starts</span>
        <input className="input" type="time" name="start_time" defaultValue={valueOf(state, 'start_time', '08:00')} />
      </label>
      <label className="block">
        <span className="label">Ends</span>
        <input className="input" type="time" name="end_time" defaultValue={valueOf(state, 'end_time', '17:00')} />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Lead organizer (optional)</span>
        <select className="input" name="lead_organizer_id" defaultValue={valueOf(state, 'lead_organizer_id', '')}>
          <option value="">—</option>
          {organizers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </label>
      {state.error && <p role="alert" className="text-sm text-bad sm:col-span-3">{state.error}</p>}
      <div className="sm:col-span-3">
        <button className="btn" disabled={pending}>Add session</button>
      </div>
    </form>
  );
}

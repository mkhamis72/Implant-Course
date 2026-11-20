'use client';

import { useActionState } from 'react';
import { valueOf, type FormState } from '@/lib/patients/form-state';
import type { Option } from '@/lib/inventory/types';
import { addSurgeryDay } from './actions';

/** Adds a surgery session on the day being viewed; `courses` are the courses whose dates include it. */
export function SurgeryDayForm({ date, courses }: { date: string; courses: Option[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addSurgeryDay, {});
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-3" key={state.ok}>
      <input type="hidden" name="date" value={date} readOnly />
      <label className="block sm:col-span-2">
        <span className="label">Course</span>
        <select className="input" name="course_id" defaultValue={valueOf(state, 'course_id', courses[0]?.id)} key={state.error}>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="label">Session title</span>
        <input className="input" name="title" defaultValue={valueOf(state, 'title', 'Surgery day')} />
      </label>
      <label className="block">
        <span className="label">Starts</span>
        <input className="input" type="time" name="start_time" defaultValue={valueOf(state, 'start_time', '08:00')} />
      </label>
      <label className="block">
        <span className="label">Ends</span>
        <input className="input" type="time" name="end_time" defaultValue={valueOf(state, 'end_time', '17:00')} />
      </label>
      <label className="block">
        <span className="label">Room (optional)</span>
        <input className="input" name="room" defaultValue={valueOf(state, 'room', '')} placeholder="e.g. Clinic 2" />
      </label>
      {state.error && <p role="alert" className="text-sm text-bad sm:col-span-3">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm text-ok sm:col-span-3">{state.ok}</p>}
      <div className="sm:col-span-3">
        <button className="btn" disabled={pending}>Add surgery day</button>
      </div>
    </form>
  );
}

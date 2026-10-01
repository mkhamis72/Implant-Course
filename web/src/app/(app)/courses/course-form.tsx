'use client';

import { useActionState } from 'react';
import type { Course } from '@/lib/schedule/types';
import { valueOf, type FormState } from '@/lib/patients/form-state';

type Props = { action: (prev: FormState, formData: FormData) => Promise<FormState>; course?: Course };

export function CourseForm({ action, course }: Props) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const v = (key: keyof Course) => valueOf(state, key, course?.[key] ?? '');
  return (
    <form action={formAction} className="card grid max-w-3xl gap-4 sm:grid-cols-2">
      {course && <input type="hidden" name="id" value={course.id} readOnly />}
      <label className="block sm:col-span-2">
        <span className="label">Course name</span>
        <input className="input" name="name" defaultValue={v('name')} />
      </label>
      <label className="block">
        <span className="label">Start date</span>
        <input className="input" type="date" name="start_date" defaultValue={v('start_date')} />
      </label>
      <label className="block">
        <span className="label">End date</span>
        <input className="input" type="date" name="end_date" defaultValue={v('end_date')} />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Venue</span>
        <input className="input" name="venue" defaultValue={v('venue')} />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Notes</span>
        <input className="input" name="notes" defaultValue={v('notes')} />
      </label>
      {state.error && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{state.error}</p>}
      {state.ok && <p className="text-sm text-green-800 sm:col-span-2">{state.ok}</p>}
      <div className="sm:col-span-2">
        <button className="btn" disabled={pending}>
          {course ? 'Save course' : 'Create course'}
        </button>
      </div>
    </form>
  );
}

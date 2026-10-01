'use client';

import { useActionState } from 'react';
import type { FormState } from '@/lib/patients/form-state';
import type { Option } from '@/lib/inventory/types';
import { enrollDelegate } from '../actions';

export function EnrollForm({ courseId, available }: { courseId: string; available: Option[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(enrollDelegate, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="course_id" value={courseId} readOnly />
      <label className="block">
        <span className="label">Delegate to enrol</span>
        <select className="input" name="delegate_id" defaultValue="">
          <option value="">Choose…</option>
          {available.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
      </label>
      <button className="btn-secondary btn" disabled={pending}>Enrol</button>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
    </form>
  );
}

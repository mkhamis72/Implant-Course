'use client';

import { useActionState } from 'react';
import type { FormState } from '@/lib/patients/form-state';
import { cancelBooking } from './actions';

export function CancelBooking({ slotId }: { slotId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(cancelBooking, {});
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-red-700">Cancel booking</summary>
      <form action={action} className="mt-1 space-y-1">
        <input type="hidden" name="slot_id" value={slotId} readOnly />
        <label className="block">
          <span className="sr-only">Reason</span>
          <input className="input py-1 text-xs" name="reason" aria-label="Reason" placeholder="Reason" />
        </label>
        <button className="btn-secondary btn py-0.5 text-xs" disabled={pending}>Cancel surgery</button>
        {state.error && <p role="alert" className="text-red-700">{state.error}</p>}
      </form>
    </details>
  );
}

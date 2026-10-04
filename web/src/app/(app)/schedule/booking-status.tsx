'use client';

import { useActionState } from 'react';
import type { FormState } from '@/lib/patients/form-state';
import { setBookingStatus } from './actions';

/** Mark a scheduled booking completed, or reopen a completed one. */
export function BookingStatus({ slotId, status }: { slotId: string; status: 'scheduled' | 'done' }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setBookingStatus, {});
  return (
    <form action={action} className="text-xs">
      <input type="hidden" name="slot_id" value={slotId} readOnly />
      <input type="hidden" name="status" value={status === 'scheduled' ? 'done' : 'scheduled'} readOnly />
      <button className="text-accent-strong hover:underline" disabled={pending}>
        {status === 'scheduled' ? 'Mark completed' : 'Reopen'}
      </button>
      {state.error && <p role="alert" className="text-bad">{state.error}</p>}
    </form>
  );
}

'use client';

import { useActionState } from 'react';
import type { FormState } from '@/lib/patients/form-state';
import { setArchived } from '../../actions';

export function ArchiveButton({ patientId, archived }: { patientId: string; archived: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setArchived, {});
  return (
    <form action={action} className="card max-w-2xl space-y-2">
      <h2 className="font-semibold">{archived ? 'Archived patient' : 'Archive'}</h2>
      <p className="text-sm text-gray-600">
        Archived patients are hidden from search but keep their full record. Nothing is deleted.
      </p>
      <input type="hidden" name="id" value={patientId} readOnly />
      <input type="hidden" name="archived" value={archived ? 'false' : 'true'} readOnly />
      <button className="btn-secondary btn" disabled={pending}>
        {archived ? 'Restore patient' : 'Archive patient'}
      </button>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
    </form>
  );
}

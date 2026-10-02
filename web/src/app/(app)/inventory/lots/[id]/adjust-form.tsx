'use client';

import { useActionState } from 'react';
import { valueOf, type FormState } from '@/lib/patients/form-state';
import { adjustStock } from './actions';

export function AdjustForm({ lotId }: { lotId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(adjustStock, {});
  return (
    <form action={action} className="card grid max-w-3xl gap-4 sm:grid-cols-4" key={state.ok}>
      <h2 className="font-semibold sm:col-span-4">Record a change</h2>
      <input type="hidden" name="stock_lot_id" value={lotId} readOnly />
      <label className="block">
        <span className="label">Reason</span>
        <select className="input" name="reason" defaultValue={valueOf(state, 'reason', 'waste')}>
          <option value="waste">Waste</option>
          <option value="return">Return to supplier</option>
          <option value="adjust">Stock count correction</option>
        </select>
      </label>
      <label className="block">
        <span className="label">Direction</span>
        <select className="input" name="direction" defaultValue={valueOf(state, 'direction', 'out')}>
          <option value="out">Take out</option>
          <option value="in">Add back</option>
        </select>
      </label>
      <label className="block">
        <span className="label">Quantity</span>
        <input className="input" name="quantity" inputMode="numeric" defaultValue={valueOf(state, 'quantity', '1')} />
      </label>
      <label className="block sm:col-span-4">
        <span className="label">Note</span>
        <input className="input" name="note" defaultValue={valueOf(state, 'note', '')} />
      </label>
      {state.error && <p role="alert" className="text-sm text-bad sm:col-span-4">{state.error}</p>}
      {state.ok && <p className="text-sm text-ok sm:col-span-4">{state.ok}</p>}
      <div className="sm:col-span-4">
        <button className="btn-secondary btn" disabled={pending}>
          Record change
        </button>
      </div>
    </form>
  );
}

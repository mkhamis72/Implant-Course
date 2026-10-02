'use client';

import { useActionState } from 'react';
import { valueOf, type FormState } from '@/lib/patients/form-state';
import { receiveStock } from './actions';

type Group = { brand: string; options: { id: string; label: string }[] };

export function ReceiveForm({ groups, productId, today }: { groups: Group[]; productId: string; today: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(receiveStock, {});
  return (
    <form action={action} className="card grid max-w-3xl gap-4 sm:grid-cols-2">
      <label className="block sm:col-span-2">
        <span className="label">Product</span>
        <select className="input" name="product_id" defaultValue={valueOf(state, 'product_id', productId)}>
          <option value="">Choose a product…</option>
          {groups.map((g) => (
            <optgroup key={g.brand} label={g.brand}>
              {g.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">Quantity</span>
        <input className="input" name="quantity" inputMode="numeric" defaultValue={valueOf(state, 'quantity', '')} />
      </label>
      <label className="block">
        <span className="label">Received on</span>
        <input className="input" name="received_on" type="date" defaultValue={valueOf(state, 'received_on', today)} />
      </label>
      <label className="block">
        <span className="label">Lot number (optional)</span>
        <input className="input" name="lot_no" defaultValue={valueOf(state, 'lot_no', '')} />
      </label>
      <label className="block">
        <span className="label">Expiry (optional)</span>
        <input className="input" name="expiry" type="date" defaultValue={valueOf(state, 'expiry', '')} />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Notes (optional)</span>
        <input className="input" name="notes" defaultValue={valueOf(state, 'notes', '')} />
      </label>
      {state.error && <p role="alert" className="text-sm text-bad sm:col-span-2">{state.error}</p>}
      <div className="sm:col-span-2">
        <button className="btn" disabled={pending}>
          Receive
        </button>
      </div>
    </form>
  );
}

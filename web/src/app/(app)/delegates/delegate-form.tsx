'use client';

import { useActionState } from 'react';
import { checkedOf, valueOf, type FormState } from '@/lib/patients/form-state';

export type DelegateRow = {
  id: string;
  full_name: string;
  phone: string;
  email: string;
  licence_no: string;
  notes: string;
  active: boolean;
};

type Props = {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  delegate?: DelegateRow;
};

export function DelegateForm({ action, delegate }: Props) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  // After a successful add, show empty fields again; after a failure, keep the typed values.
  const v = (key: keyof DelegateRow) => valueOf(state, key, state.ok && !delegate ? '' : ((delegate?.[key] as string) ?? ''));
  return (
    <form action={formAction} className="card grid max-w-2xl gap-4 sm:grid-cols-2" key={delegate ? delegate.id : state.ok}>
      {delegate && <input type="hidden" name="id" value={delegate.id} readOnly />}
      <label className="block">
        <span className="label">Full name</span>
        <input className="input" name="full_name" defaultValue={v('full_name')} />
      </label>
      <label className="block">
        <span className="label">Licence number</span>
        <input className="input" name="licence_no" defaultValue={v('licence_no')} />
      </label>
      <label className="block">
        <span className="label">Phone</span>
        <input className="input" name="phone" type="tel" defaultValue={v('phone')} />
      </label>
      <label className="block">
        <span className="label">Email</span>
        <input className="input" name="email" type="text" inputMode="email" defaultValue={v('email')} />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Notes</span>
        <input className="input" name="notes" defaultValue={v('notes')} />
      </label>
      {delegate && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={checkedOf(state, 'active', delegate.active)} />
          Active
        </label>
      )}
      {state.error && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{state.error}</p>}
      {state.ok && <p className="text-sm text-green-800 sm:col-span-2">{state.ok}</p>}
      <div className="sm:col-span-2">
        <button className="btn" disabled={pending}>
          {delegate ? 'Save delegate' : 'Add delegate'}
        </button>
      </div>
    </form>
  );
}

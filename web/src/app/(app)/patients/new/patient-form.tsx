'use client';

import { useActionState } from 'react';
import type { Patient } from '@/lib/patients/types';
import { valueOf, type FormState } from '@/lib/patients/form-state';

type Props = {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  patient?: Patient;
};

export function PatientForm({ action, patient }: Props) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const v = (key: keyof Patient) => valueOf(state, key, (patient?.[key] as string | null | undefined) ?? '');
  return (
    <form action={formAction} className="card grid max-w-2xl gap-4 sm:grid-cols-2">
      {patient && (
        <>
          <input type="hidden" name="id" value={patient.id} readOnly />
          <input type="hidden" name="expected_updated_at" value={patient.updated_at} readOnly />
        </>
      )}
      <label className="block sm:col-span-2">
        <span className="label">Full name</span>
        <input className="input" name="full_name" required defaultValue={v('full_name')} />
      </label>
      <label className="block">
        <span className="label">File number</span>
        <input className="input" name="file_no" placeholder={patient ? undefined : 'Assigned automatically'} defaultValue={v('file_no')} />
      </label>
      <label className="block">
        <span className="label">Date of birth</span>
        <input className="input" name="dob" type="date" defaultValue={v('dob')} />
      </label>
      <label className="block">
        <span className="label">Sex</span>
        <select className="input" name="sex" defaultValue={v('sex')}>
          <option value="">—</option>
          <option value="female">Female</option>
          <option value="male">Male</option>
        </select>
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
        <span className="label">Address</span>
        <input className="input" name="address" defaultValue={v('address')} />
      </label>
      {state.error && <p role="alert" className="text-sm text-bad sm:col-span-2">{state.error}</p>}
      {state.ok && <p className="text-sm text-ok sm:col-span-2">{state.ok}</p>}
      <div className="sm:col-span-2">
        <button className="btn" disabled={pending}>
          Save patient
        </button>
      </div>
    </form>
  );
}

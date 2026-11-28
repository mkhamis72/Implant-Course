'use client';

import { useActionState } from 'react';
import type { FormState } from '@/lib/patients/form-state';
import { valueOf } from '@/lib/patients/form-state';
import { SCREW_KINDS, SCREW_KIND_LABELS, systemKey, type ScrewSize } from '@/lib/admin/screw-sizes';
import { saveScrewSize } from './actions';

export type SystemOption = { brand: string; system: string };

/** Add form (no size) or the edit form of one size. The brand and system are one select. */
export function ScrewSizeForm({ systems, size, onDone }: { systems: SystemOption[]; size?: ScrewSize; onDone?: () => void }) {
  const [state, action, pending] = useActionState<FormState, FormData>(async (prev, formData) => {
    const next = await saveScrewSize(prev, formData);
    if (next.ok) onDone?.();
    return next;
  }, {});
  // A fresh form after each successful add (React 19 resets the form; selects fall back to their first option).
  const key = size ? size.id : (state.ok ?? 'new');
  return (
    <form action={action} key={key} className="card flex flex-wrap items-end gap-3" aria-label={size ? `Edit ${size.label}` : 'Add screw size'}>
      {size && <input type="hidden" name="id" value={size.id} readOnly />}
      <label className="block">
        <span className="label">Implant system</span>
        <select className="input" name="system" required defaultValue={valueOf(state, 'system', size ? systemKey(size.brand, size.system) : '')}>
          <option value="">Choose…</option>
          {systems.map((s) => (
            <option key={systemKey(s.brand, s.system)} value={systemKey(s.brand, s.system)}>{s.brand} · {s.system}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">Kind</span>
        <select className="input" name="kind" defaultValue={valueOf(state, 'kind', size?.kind ?? 'abutment_screw')}>
          {SCREW_KINDS.map((k) => <option key={k} value={k}>{SCREW_KIND_LABELS[k]}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="label">Size</span>
        <input className="input w-36" name="label" maxLength={40} placeholder="e.g. M1.6 × 5" defaultValue={valueOf(state, 'label', size?.label)} />
      </label>
      <label className="block">
        <span className="label">Driver interface</span>
        <input className="input w-32" name="driver_interface" maxLength={60} placeholder="e.g. Hex" defaultValue={valueOf(state, 'driver_interface', size?.driver_interface)} />
      </label>
      <label className="block">
        <span className="label">Driver size</span>
        <input className="input w-24" name="driver_size" maxLength={30} placeholder="e.g. 1.25" defaultValue={valueOf(state, 'driver_size', size?.driver_size)} />
      </label>
      <label className="block">
        <span className="label">Driver ref</span>
        <input className="input w-32" name="driver_ref" maxLength={60} defaultValue={valueOf(state, 'driver_ref', size?.driver_ref)} />
      </label>
      <label className="block">
        <span className="label">Torque (Ncm)</span>
        <input className="input w-24" name="torque" inputMode="decimal" defaultValue={valueOf(state, 'torque', size?.torque_ncm != null ? String(size.torque_ncm) : '')} />
      </label>
      <button className="btn" disabled={pending}>{size ? 'Save' : 'Add screw size'}</button>
      {state.error && <p role="alert" className="w-full text-sm text-bad">{state.error}</p>}
    </form>
  );
}

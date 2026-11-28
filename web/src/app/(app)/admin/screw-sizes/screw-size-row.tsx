'use client';

import { useActionState, useState } from 'react';
import type { FormState } from '@/lib/patients/form-state';
import { SCREW_KIND_LABELS, screwDriverLine, type ScrewSize } from '@/lib/admin/screw-sizes';
import { ScrewSizeForm, type SystemOption } from './screw-size-form';
import { setScrewSizeActive } from './actions';

/** One size as a table row: Edit opens the form in a row below; Switch off/on keeps the row. */
export function ScrewSizeRow({ size, systems }: { size: ScrewSize; systems: SystemOption[] }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState<FormState, FormData>(setScrewSizeActive, {});
  const driver = [size.driver_interface, size.driver_size, size.driver_ref ? `ref ${size.driver_ref}` : ''].filter(Boolean).join(' · ');
  return (
    <>
      <tr data-testid={`screw-size-${size.label}`} className={size.active ? '' : 'text-muted'}>
        <td data-label="Kind">{SCREW_KIND_LABELS[size.kind]}</td>
        <td data-label="Size">{size.label}</td>
        <td data-label="Screwdriver" title={screwDriverLine(size)}>{driver || '—'}</td>
        <td data-label="Torque">{size.torque_ncm != null ? `${size.torque_ncm} Ncm` : '—'}</td>
        <td data-label="Active">
          <span className={size.active ? 'badge-ok' : 'badge'}>{size.active ? 'Active' : 'Off'}</span>
        </td>
        <td data-label="">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary btn py-1" onClick={() => setEditing((e) => !e)} aria-label={`Edit ${size.label}`}>
              {editing ? 'Close' : 'Edit'}
            </button>
            <form action={action}>
              <input type="hidden" name="id" value={size.id} readOnly />
              <input type="hidden" name="active" value={size.active ? 'false' : 'true'} readOnly />
              <button className="btn-secondary btn py-1" disabled={pending} aria-label={`${size.active ? 'Switch off' : 'Switch on'} ${size.label}`}>
                {size.active ? 'Switch off' : 'Switch on'}
              </button>
            </form>
            {state.error && <span role="alert" className="text-sm text-bad">{state.error}</span>}
          </div>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={6} data-label="">
            <ScrewSizeForm systems={systems} size={size} onDone={() => setEditing(false)} />
          </td>
        </tr>
      )}
    </>
  );
}

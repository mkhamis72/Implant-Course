import { ConfirmDelete } from '@/components/confirm-delete';
import { deletePatient } from './actions';

/** Delete a patient after typing their name; used in the patient header and on each Patients list row. */
export function DeletePatient(p: { id: string; name: string; triggerLabel?: string; triggerClassName?: string; panelClassName?: string }) {
  return (
    <ConfirmDelete
      {...p}
      noun="patient"
      consequences="Their chart, plans, notes and surgery bookings are deleted too. A patient with a placed implant or fitted component can't be deleted — archive them instead."
      action={deletePatient}
    />
  );
}

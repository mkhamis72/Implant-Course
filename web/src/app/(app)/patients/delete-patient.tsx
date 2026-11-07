import { ConfirmDelete } from '@/components/confirm-delete';
import { deletePatient } from './actions';

/** Delete a patient after typing their name; used in the patient header and on each Patients list row. */
export function DeletePatient(p: { id: string; name: string; triggerLabel?: string; triggerClassName?: string; panelClassName?: string }) {
  return (
    <ConfirmDelete
      {...p}
      noun="patient"
      consequences="Their chart, plans, notes, surgery bookings, placed implants and fitted components are deleted too, and the implants' and components' stock goes back to inventory. Use this for a duplicate or mistaken patient; archive a real patient instead."
      action={deletePatient}
    />
  );
}

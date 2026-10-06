import { ConfirmDelete } from '@/components/confirm-delete';
import { deleteDelegate } from '../actions';

/** Delete a delegate added by mistake, after typing their name. */
export function DeleteDelegate({ id, name }: { id: string; name: string }) {
  return (
    <ConfirmDelete
      id={id}
      name={name}
      noun="delegate"
      consequences="Their course enrollments and their login (if any) are deleted too. A delegate with implant records or surgery bookings can't be deleted — set them Inactive instead."
      action={deleteDelegate}
    />
  );
}

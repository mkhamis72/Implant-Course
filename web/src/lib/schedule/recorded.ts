export type RecordedPeople = { supervisor_id: string | null; placing_doctor_id: string | null };

/**
 * True for a booking made before the company became a clinic whose delegates place the implants: every booking
 * placed by delegates has a supervisor and no doctor (0024, 0115), and a clinic's own bookings always have a doctor.
 * A clinic can't read slot_delegates, so this is read from the booking itself.
 */
export function placedByRecordedDelegates(slot: RecordedPeople): boolean {
  return slot.placing_doctor_id === null && slot.supervisor_id !== null;
}

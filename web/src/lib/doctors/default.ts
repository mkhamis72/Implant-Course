/** The doctor a "Placed by" select starts on: the active doctor linked to my login, else none (''). */
export function defaultDoctorId(doctors: { id: string; user_id: string | null; active: boolean }[], me: string): string {
  return doctors.find((d) => d.active && d.user_id !== null && d.user_id === me)?.id ?? '';
}

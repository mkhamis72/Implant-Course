import { addDays } from '@/lib/dates';

/** The Saturday–Friday week (the clinic week in Egypt) containing a "YYYY-MM-DD" date. */
export function weekOf(date: string): { from: string; to: string; prev: string; next: string } {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 Sunday … 6 Saturday
  const from = addDays(date, -((day + 1) % 7));
  return { from, to: addDays(from, 6), prev: addDays(from, -7), next: addDays(from, 7) };
}

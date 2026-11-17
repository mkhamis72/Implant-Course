import { formatDate } from '@/lib/format';

/** A surgery session in a list: "date · course · title"; a clinic day has no course. */
export function sessionLabel(s: { date: string; title: string; course: { name: string } | null }): string {
  return [formatDate(s.date), s.course?.name, s.title].filter(Boolean).join(' · ');
}

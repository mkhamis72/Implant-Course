import { formatDate } from '@/lib/format';
import { SETTING_LABELS, type Setting } from './types';

/** A surgery session in a list: "date · course · title"; a clinic day has no course. */
export function sessionLabel(s: { date: string; title: string; course: { name: string } | null }): string {
  return [formatDate(s.date), s.course?.name, s.title].filter(Boolean).join(' · ');
}

/** "Where: GA in hospital" on a clinic booking card; nothing when unset or for a course organizer. */
export function whereLine(setting: Setting | null, teaching: boolean): string | null {
  return !teaching && setting ? `Where: ${SETTING_LABELS[setting]}` : null;
}

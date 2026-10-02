import { formatDateTime, formatTime } from '@/lib/format';
import { todayIso } from '@/lib/dates';
import type { ChecklistScope } from './types';

export const SCOPE_LABELS: Record<ChecklistScope, string> = {
  general: 'General',
  lecture: 'Lecture',
  workshop: 'Workshop',
  surgery: 'Surgery session',
  surgery_booking: 'Surgery booking (per patient)',
};

export function progressOf(items: readonly { done_at: string | null }[]): { done: number; total: number; label: string } {
  const done = items.filter((i) => i.done_at).length;
  return { done, total: items.length, label: items.length ? `${done}/${items.length} done` : 'No items' };
}

/** "✓ Name · 14:32" when ticked today (Cairo), otherwise with the date. */
export function doneLabel(name: string, at: string, today: string = todayIso()): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(at));
  return `✓ ${name} · ${day === today ? formatTime(at) : formatDateTime(at)}`;
}

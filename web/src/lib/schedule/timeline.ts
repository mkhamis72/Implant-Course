/** The Lectures / Workshops timetable: talks with the breaks between them, the day buttons, the session to open. */
import { formatTime } from '@/lib/format';

/** A gap this long or longer between two talks is shown as a break (breaks aren't stored; talks never overlap). */
export const BREAK_MIN_MINUTES = 10;

type TalkTimes = { id: string; starts_at: string; ends_at: string };
export type TimelineItem<T extends TalkTimes> = { kind: 'talk'; talk: T } | { kind: 'break'; from: string; to: string };

export function talkTimeline<T extends TalkTimes>(talks: T[]): TimelineItem<T>[] {
  const sorted = [...talks].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const items: TimelineItem<T>[] = [];
  sorted.forEach((t, i) => {
    const prev = sorted[i - 1];
    if (prev && Date.parse(t.starts_at) - Date.parse(prev.ends_at) >= BREAK_MIN_MINUTES * 60_000) {
      items.push({ kind: 'break', from: formatTime(prev.ends_at), to: formatTime(t.starts_at) });
    }
    items.push({ kind: 'talk', talk: t });
  });
  return items;
}

export type DayButton = { date: string; weekday: string; day: string; selected: boolean };

const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' });

/** The days that have sessions, plus the selected day, once each and in order ("Wed" + "4"). */
export function dayButtons(selected: string, sessionDates: string[]): DayButton[] {
  return [...new Set([...sessionDates, selected])].sort().map((date) => ({
    date,
    weekday: weekday.format(new Date(`${date}T00:00:00Z`)),
    day: String(Number(date.slice(8, 10))),
    selected: date === selected,
  }));
}

type SessionTimes = { id: string; date: string; start_time: string; end_time: string };

/** The session to show open: on today's page the one running now, else the next one; otherwise the first. */
export function openSessionId(sessions: SessionTimes[], today: string, nowHhmm: string): string | null {
  if (!sessions.length) return null;
  const hhmm = (t: string) => t.slice(0, 5);
  const todays = sessions.filter((s) => s.date === today);
  const current = todays.find((s) => hhmm(s.start_time) <= nowHhmm && nowHhmm < hhmm(s.end_time))
    ?? todays.find((s) => hhmm(s.start_time) > nowHhmm);
  return (current ?? sessions[0]).id;
}

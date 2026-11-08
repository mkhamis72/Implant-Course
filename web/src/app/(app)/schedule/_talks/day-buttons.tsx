import Link from 'next/link';
import { addDays, todayIso } from '@/lib/dates';
import type { DayButton } from '@/lib/schedule/timeline';
import type { TalkKind } from '@/lib/schedule/talks';
import { DayRow } from './day-row';

/** The timetable's day row: one button per day with sessions (and the chosen day), then earlier / Today / later. */
export function DayButtons({ kind, date, days, span }: { kind: TalkKind; date: string; days: DayButton[]; span: number }) {
  const href = (d: string) => `/schedule/${kind}?date=${d}`;
  return (
    <nav aria-label="Day" className="space-y-2">
      <DayRow>
        {days.map((d) => (
          <li key={d.date} className="snap-center">
            <Link
              href={href(d.date)}
              aria-current={d.selected ? 'date' : undefined}
              aria-label={`${d.weekday} ${d.day}`}
              className={`pressable flex min-h-11 min-w-14 flex-col items-center justify-center rounded-xl border px-3 py-1 leading-tight ${
                d.selected ? 'border-2 border-accent bg-surface text-accent' : 'border-line bg-accent-soft text-ink hover:border-accent'
              }`}
            >
              <span className="text-xs">{d.weekday}</span>
              <span className="text-lg font-semibold tabular-nums">{d.day}</span>
            </Link>
          </li>
        ))}
      </DayRow>
      <p className="-ml-2 flex gap-2 text-sm">
        <Link href={href(addDays(date, -span))} className="inline-flex min-h-11 items-center px-2 text-accent hover:underline">‹ Earlier</Link>
        <Link href={href(todayIso())} className="inline-flex min-h-11 items-center px-2 text-accent hover:underline">Today</Link>
        <Link href={href(addDays(date, span))} className="inline-flex min-h-11 items-center px-2 text-accent hover:underline">Later ›</Link>
      </p>
    </nav>
  );
}

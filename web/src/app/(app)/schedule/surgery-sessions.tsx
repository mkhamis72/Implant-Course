import Link from 'next/link';
import type { Option } from '@/lib/inventory/types';
import { SurgeryDayForm } from './surgery-day-form';

export type DaySession = {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  room: string | null;
  course: { id: string; name: string } | null;
};

/**
 * The day's surgery sessions (bookings need one). Schedule editors can book into them and add a surgery
 * day for a course running that day.
 */
export function SurgerySessions(p: { date: string; sessions: DaySession[]; courses: Option[]; editable: boolean; coursesVisible: boolean }) {
  return (
    <section className="card space-y-2 text-sm" aria-labelledby="surgery-sessions">
      <h2 id="surgery-sessions" className="font-semibold">Surgery sessions</h2>
      {p.sessions.length === 0 ? (
        <p className="text-muted">No surgery session on this day{p.editable ? ': add one to start booking.' : '.'}</p>
      ) : (
        <ul className="divide-y divide-line">
          {p.sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-1">
              <span>
                <span className="font-medium">{s.title}</span> · {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                {s.room && ` · ${s.room}`}
                {s.course && (
                  <>
                    {' · '}
                    {p.coursesVisible ? (
                      <Link href={`/courses/${s.course.id}`} className="text-accent hover:underline">{s.course.name}</Link>
                    ) : (
                      s.course.name
                    )}
                  </>
                )}
              </span>
              {p.editable && (
                <Link href={`/schedule/new?session=${s.id}&date=${p.date}`} className="text-accent hover:underline">Book a surgery</Link>
              )}
            </li>
          ))}
        </ul>
      )}
      {p.editable &&
        (p.courses.length > 0 ? (
          <details open={p.sessions.length === 0}>
            <summary className="cursor-pointer text-accent">Add surgery day</summary>
            <div className="pt-3">
              <SurgeryDayForm date={p.date} courses={p.courses} />
            </div>
          </details>
        ) : (
          <p className="text-muted">No course runs on this day, so a surgery day can’t be added. Add or extend a course under Courses.</p>
        ))}
    </section>
  );
}

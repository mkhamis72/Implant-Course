import Link from 'next/link';
import { formatTime } from '@/lib/format';
import { todayIso } from '@/lib/dates';
import { talkTimeline } from '@/lib/schedule/timeline';
import type { DaySessionRow, TalkKind } from '@/lib/schedule/talks';
import { DeleteTalk } from './delete-talk';
import { ChevronIcon, ClockIcon, CupIcon } from './icons';

/** One session of the timetable: a coloured bar that opens onto its talks, with the breaks between them. */
export function SessionBlock({ kind, session: s, open, editable }: {
  kind: TalkKind; session: DaySessionRow; open: boolean; editable: boolean;
}) {
  const items = talkTimeline(s.talks);
  return (
    <details open={open} data-testid={`talk-session-${s.id}`} className="timetable-session group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 pressable rounded-2xl bg-accent px-5 py-3 text-white [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block font-semibold">{s.title}</span>
          <span className="block text-sm">
            {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}{s.course?.name && <> · {s.course.name}</>}
          </span>
        </span>
        <ChevronIcon className="shrink-0 text-xl transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="card mt-2 text-center">
        {items.length === 0 && <p className="text-sm text-muted">No talks yet.</p>}
        <ol>
          {items.map((item, i) =>
            item.kind === 'break' ? (
              <li key={`break-${i}`} className="py-2 text-sm text-muted"><CupIcon /> Break {item.from}–{item.to}</li>
            ) : (
              <li
                key={item.talk.id}
                data-testid={`talk-${item.talk.id}`}
                className="space-y-1 border-t-2 border-dashed border-line py-4 first:border-t-0"
              >
                <p className="text-sm font-medium text-accent tabular-nums">
                  <ClockIcon /> {formatTime(item.talk.starts_at)}–{formatTime(item.talk.ends_at)}
                </p>
                {item.talk.lecturer && <p className="text-accent">{item.talk.lecturer.full_name}</p>}
                <p className="text-lg text-ink">{item.talk.topic}</p>
                {item.talk.notes && <p className="text-sm text-muted">{item.talk.notes}</p>}
                {editable && (
                  <div className="flex justify-center gap-2 text-sm">
                    <Link href={`/schedule/${kind}/${item.talk.id}/edit`} aria-label={`Edit ${item.talk.topic}`} className="inline-flex min-h-11 items-center px-3 text-accent hover:underline">Edit</Link>
                    <DeleteTalk talkId={item.talk.id} kind={kind} />
                  </div>
                )}
              </li>
            ),
          )}
        </ol>
        {/* New talks go on sessions from today on (the form offers no others); past talks can still be edited. */}
        {editable && (
          <div className="mt-3 border-t border-line pt-3">
            {s.date < todayIso() ? (
              <span className="text-sm text-muted">Past session</span>
            ) : (
              <Link href={`/schedule/${kind}/new?session=${s.id}`} className="btn-secondary btn">Add talk</Link>
            )}
          </div>
        )}
      </div>
    </details>
  );
}

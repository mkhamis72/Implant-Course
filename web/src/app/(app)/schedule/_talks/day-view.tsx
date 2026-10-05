import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { canEdit } from '@/lib/auth/permissions';
import { addDays, isRealDate, todayIso } from '@/lib/dates';
import { formatDate, formatTime } from '@/lib/format';
import { readParams, type PageSearchParams } from '@/lib/search-params';
import { DAY_SESSION_SELECT, TALK_KINDS, type DaySessionRow, type TalkKind } from '@/lib/schedule/talks';
import { DeleteTalk } from './delete-talk';

export async function TalkDayView({ kind, searchParams }: { kind: TalkKind; searchParams: PageSearchParams }) {
  const profile = await requirePermission('schedule');
  const editable = canEdit(profile, 'schedule');
  const raw = (await readParams(searchParams, 'date')).date;
  const date = raw && isRealDate(raw) ? raw : todayIso();
  const k = TALK_KINDS[kind];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('sessions')
    .select(DAY_SESSION_SELECT)
    .eq('type', k.type)
    .eq('date', date)
    .order('start_time')
    .order('starts_at', { referencedTable: 'talks' });
  if (error) throw new Error(`Could not load the ${k.title.toLowerCase()}`);
  const sessions = (data ?? []) as unknown as DaySessionRow[];

  return (
    <div className="space-y-4">
      <div className="page-header">
        <h1>{k.title} · {formatDate(date)}</h1>
        {editable && <Link href={`/schedule/${kind}/new?date=${date}`} className="btn">New talk</Link>}
      </div>
      <nav className="flex gap-4 text-sm" aria-label="Day">
        <Link href={`/schedule/${kind}?date=${addDays(date, -1)}`} className="text-accent hover:underline">← Previous day</Link>
        <Link href={`/schedule/${kind}?date=${todayIso()}`} className="text-accent hover:underline">Today</Link>
        <Link href={`/schedule/${kind}?date=${addDays(date, 1)}`} className="text-accent hover:underline">Next day →</Link>
      </nav>
      {sessions.length === 0 && (
        <p className="card text-muted">No {k.noun} sessions on this day — add one on the course page.</p>
      )}
      {sessions.map((s) => (
        <section key={s.id} data-testid={`talk-session-${s.id}`} className="card space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="font-semibold">{s.title}</h2>
              <p className="text-sm text-muted">
                {s.course?.name} · {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                {s.room && <> · {s.room}</>}
              </p>
            </div>
            {/* New talks go on sessions from today on (the form offers no others); past talks can still be edited. */}
            {!editable ? null : s.date < todayIso() ? (
              <span className="text-sm text-muted">Past session</span>
            ) : (
              <Link href={`/schedule/${kind}/new?session=${s.id}`} className="btn-secondary btn">Add talk</Link>
            )}
          </div>
          {s.talks.length === 0 ? (
            <p className="text-sm text-muted">No talks yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {s.talks.map((t) => (
                <li key={t.id} data-testid={`talk-${t.id}`} className="flex flex-wrap items-start gap-x-6 gap-y-1 py-2 text-sm">
                  <span className="w-28 font-medium tabular-nums">{formatTime(t.starts_at)}–{formatTime(t.ends_at)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{t.topic}</span>
                    <span className="block text-muted">{t.lecturer?.full_name}</span>
                    {t.notes && <span className="block text-muted">{t.notes}</span>}
                  </span>
                  {editable && (
                    <span className="flex items-start gap-3">
                      <Link href={`/schedule/${kind}/${t.id}/edit`} aria-label={`Edit ${t.topic}`} className="text-accent hover:underline">Edit</Link>
                      <DeleteTalk talkId={t.id} kind={kind} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

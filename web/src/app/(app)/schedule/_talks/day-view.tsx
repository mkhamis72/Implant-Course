import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireTalks } from './guard';
import { canEdit } from '@/lib/auth/permissions';
import { addDays, isRealDate, todayIso } from '@/lib/dates';
import { formatDate } from '@/lib/format';
import { readParams, type PageSearchParams } from '@/lib/search-params';
import { DAY_SESSION_SELECT, TALK_KINDS, type DaySessionRow, type TalkKind } from '@/lib/schedule/talks';
import { dayButtons, openSessionId } from '@/lib/schedule/timeline';
import { DayButtons } from './day-buttons';
import { SessionBlock } from './session-block';

/** Days either side of the chosen one whose sessions get a day button. */
const DAY_SPAN = 14;

const cairoClock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Africa/Cairo' });

/**
 * Lectures or workshops as a timetable: day buttons, then each session as a bar that opens onto its talks, with
 * the breaks between them. The session room isn't shown (one hall per course).
 */
export async function TalkDayView({ kind, searchParams }: { kind: TalkKind; searchParams: PageSearchParams }) {
  const profile = await requireTalks();
  const editable = canEdit(profile, 'schedule');
  const raw = (await readParams(searchParams, 'date')).date;
  const date = raw && isRealDate(raw) ? raw : todayIso();
  const k = TALK_KINDS[kind];
  const supabase = await createClient();
  const [day, around] = await Promise.all([
    supabase
      .from('sessions')
      .select(DAY_SESSION_SELECT)
      .eq('type', k.type)
      .eq('date', date)
      .order('start_time')
      .order('starts_at', { referencedTable: 'talks' }),
    supabase
      .from('sessions')
      .select('date')
      .eq('type', k.type)
      .gte('date', addDays(date, -DAY_SPAN))
      .lte('date', addDays(date, DAY_SPAN)),
  ]);
  if (day.error || around.error) throw new Error(`Could not load the ${k.title.toLowerCase()}`);
  const sessions = (day.data ?? []) as unknown as DaySessionRow[];
  const days = dayButtons(date, (around.data ?? []).map((r) => r.date as string));
  const open = openSessionId(sessions, todayIso(), cairoClock.format(new Date()));

  return (
    <div className="space-y-4">
      <div className="page-header">
        <h1>{k.title} · {formatDate(date)}</h1>
        {editable && <Link href={`/schedule/${kind}/new?date=${date}`} className="btn">New talk</Link>}
      </div>
      <DayButtons kind={kind} date={date} days={days} span={DAY_SPAN} />
      {sessions.length === 0 && (
        <p className="card text-muted">No {k.noun} sessions on this day — add one on the course page.</p>
      )}
      {sessions.map((s) => (
        <SessionBlock key={s.id} kind={kind} session={s} open={s.id === open} editable={editable} />
      ))}
    </div>
  );
}

import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { todayIso } from '@/lib/dates';
import { formatDate } from '@/lib/format';
import { readParams, type PageSearchParams } from '@/lib/search-params';
import { TALK_KINDS, type TalkKind } from '@/lib/schedule/talks';
import { TalkForm } from './talk-form';

type SessionOptionRow = { id: string; title: string; date: string; start_time: string; end_time: string; course: { name: string } | null };

export async function NewTalkPage({ kind, searchParams }: { kind: TalkKind; searchParams: PageSearchParams }) {
  await requirePermission('schedule', 'edit');
  const q = await readParams(searchParams, 'session', 'date');
  const k = TALK_KINDS[kind];
  const supabase = await createClient();
  const results = await Promise.all([
    supabase.from('sessions').select('id, title, date, start_time, end_time, course:courses(name)')
      .eq('type', k.type).gte('date', todayIso()).order('date').order('start_time'),
    supabase.from('lecturers').select('id, full_name').eq('active', true).order('full_name'),
  ]);
  // A failed query must not look like an empty list (e.g. "no sessions").
  if (results.some((r) => r.error)) throw new Error('Could not load the talk form');
  const [{ data: sessions }, { data: lecturers }] = results;
  const rows = (sessions ?? []) as unknown as SessionOptionRow[];
  const initialSession = q.session || rows.find((s) => s.date === q.date)?.id || '';
  const first = rows.find((s) => s.id === initialSession);

  return (
    <div className="space-y-6">
      <h1>New {k.noun} talk</h1>
      <TalkForm
        kind={kind}
        sessions={rows.map((s) => ({
          id: s.id,
          label: `${formatDate(s.date)} · ${s.course?.name ?? ''} · ${s.title} (${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)})`,
        }))}
        lecturers={(lecturers ?? []).map((l) => ({ id: l.id as string, label: l.full_name as string }))}
        initial={{ sessionId: initialSession, start: first?.start_time.slice(0, 5) ?? '09:00', end: '', lecturerId: '', topic: '', notes: '' }}
      />
    </div>
  );
}

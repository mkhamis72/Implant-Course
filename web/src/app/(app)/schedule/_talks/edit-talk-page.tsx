import { notFound } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireActiveUser } from '@/lib/auth/session';
import { formatDate, formatTime } from '@/lib/format';
import { TALK_KINDS, TALK_SELECT, type TalkKind, type TalkRow } from '@/lib/schedule/talks';
import { TalkForm } from './talk-form';

type EditRow = TalkRow & { session: { type: string; title: string; date: string; course: { name: string } | null } | null };

export async function EditTalkPage({ kind, params }: { kind: TalkKind; params: Promise<{ id: string }> }) {
  await requireActiveUser();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const k = TALK_KINDS[kind];
  const supabase = await createClient();
  const { data } = await supabase
    .from('talks')
    .select(`${TALK_SELECT}, session:sessions(type, title, date, course:courses(name))`)
    .eq('id', id)
    .maybeSingle();
  const talk = data as unknown as EditRow | null;
  if (!talk?.session || talk.session.type !== k.type) notFound();
  // The talk's current lecturer stays selectable even if deactivated since.
  const { data: lecturers, error } = await supabase
    .from('lecturers')
    .select('id, full_name')
    .or(`active.eq.true,id.eq.${talk.lecturer_id}`)
    .order('full_name');
  if (error) throw new Error('Could not load lecturers');

  return (
    <div className="space-y-6">
      <h1>Edit {k.noun} talk</h1>
      <TalkForm
        kind={kind}
        sessionLabel={`${formatDate(talk.session.date)} · ${talk.session.course?.name ?? ''} · ${talk.session.title}`}
        lecturers={(lecturers ?? []).map((l) => ({ id: l.id as string, label: l.full_name as string }))}
        initial={{
          talkId: talk.id, sessionId: talk.session_id, start: formatTime(talk.starts_at), end: formatTime(talk.ends_at),
          lecturerId: talk.lecturer_id, topic: talk.topic, notes: talk.notes,
        }}
      />
    </div>
  );
}

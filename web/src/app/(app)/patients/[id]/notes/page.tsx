import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { formatDate, formatDateTime } from '@/lib/format';
import type { VisitNote } from '@/lib/patients/types';
import { NoteForm } from './note-form';

function cairoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
}

export default async function NotesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('visit_notes')
    .select('id, visit_date, text, teeth, created_at, author:profiles(full_name, email)')
    .eq('patient_id', id)
    .order('visit_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw new Error('Could not load notes');
  const notes = (data ?? []) as unknown as VisitNote[];

  return (
    <div className="space-y-6">
      <NoteForm patientId={id} today={cairoToday()} />
      <section className="space-y-3">
        <h2 className="font-semibold">Notes</h2>
        {notes.length === 0 && <p className="text-sm text-gray-600">No notes yet.</p>}
        <ol className="space-y-3">
          {notes.map((note) => (
            <li key={note.id} data-testid="visit-note" className="card space-y-2 py-4">
              <div className="flex flex-wrap items-center gap-x-4 text-sm text-gray-600">
                <span className="font-medium text-gray-900">{formatDate(note.visit_date)}</span>
                <span>{note.author?.full_name || note.author?.email || 'Unknown'}</span>
                <span>written {formatDateTime(note.created_at)}</span>
                {note.teeth.length > 0 && (
                  <span className="flex gap-1">
                    {note.teeth.map((t) => (
                      <Link key={t} href={`/patients/${id}?tooth=${t}`} className="rounded bg-blue-50 px-1.5 text-blue-800 hover:underline">
                        {t}
                      </Link>
                    ))}
                  </span>
                )}
              </div>
              <p className="whitespace-pre-wrap">{note.text}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

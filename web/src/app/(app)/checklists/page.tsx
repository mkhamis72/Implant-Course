import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth/session';
import { formatDate, formatDateTime } from '@/lib/format';
import { progressOf } from '@/lib/checklists/format';
import type { ChecklistSummary } from '@/lib/checklists/types';
import { NewChecklistForm } from './new-checklist-form';

const SUMMARY_SELECT = `
  id, title,
  session:sessions(id, title, date, course_id),
  slot:surgery_slots(id, starts_at, patient:patients(full_name)),
  items:checklist_items(done_at, assignee_id)
`;

function attachedTo(c: ChecklistSummary): string {
  if (c.session) return `Session · ${c.session.title} · ${formatDate(c.session.date)}`;
  if (c.slot) return `Surgery · ${c.slot.patient?.full_name ?? ''} · ${formatDateTime(c.slot.starts_at)}`;
  return 'Standalone';
}

export default async function ChecklistsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view = 'open' } = await searchParams;
  const supabase = await createClient();
  const me = await getCurrentProfile();
  const [{ data: lists, error }, { data: templates }, { data: mine }] = await Promise.all([
    supabase.from('checklists').select(SUMMARY_SELECT).order('created_at', { ascending: false }).limit(300),
    supabase.from('checklist_templates').select('id, name').order('name'),
    supabase
      .from('checklist_items')
      .select('id, text, due_date, checklist:checklists(id, title)')
      .eq('assignee_id', me?.user_id ?? '')
      .is('done_at', null)
      .order('due_date', { ascending: true, nullsFirst: false }),
  ]);
  if (error) throw new Error('Could not load checklists');
  const all = (lists ?? []) as unknown as ChecklistSummary[];
  const shown = view === 'all' ? all : all.filter((c) => c.items.some((i) => !i.done_at));
  const myItems = (mine ?? []) as unknown as { id: string; text: string; due_date: string | null; checklist: { id: string; title: string } }[];
  const tab = (key: string, label: string) => (
    <Link
      href={`/checklists?view=${key}`}
      aria-current={view === key ? 'page' : undefined}
      className={`border-b-2 px-3 py-2 text-sm ${view === key ? 'border-blue-700 font-medium text-blue-700' : 'border-transparent text-gray-600'}`}
    >
      {label}
    </Link>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Checklists</h1>
      <nav aria-label="Checklist views" className="flex gap-1 border-b border-gray-200">
        {tab('open', 'Open')}
        {tab('mine', 'Mine')}
        {tab('all', 'All')}
        <Link href="/checklists/templates" className="border-b-2 border-transparent px-3 py-2 text-sm text-gray-600">Templates</Link>
      </nav>
      {view === 'mine' ? (
        <ul className="card divide-y divide-gray-100">
          {myItems.length === 0 && <li className="text-gray-600">Nothing assigned to you is open.</li>}
          {myItems.map((i) => (
            <li key={i.id} data-testid="my-item" className="flex flex-wrap gap-x-6 py-2 text-sm">
              <span className="font-medium">{i.text}</span>
              <Link href={`/checklists/${i.checklist.id}`} className="text-blue-700 hover:underline">{i.checklist.title}</Link>
              {i.due_date && <span className="text-gray-600">due {formatDate(i.due_date)}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="card divide-y divide-gray-100">
          {shown.length === 0 && <li className="text-gray-600">No checklists here.</li>}
          {shown.map((c) => (
            <li key={c.id} className="flex flex-wrap gap-x-6 py-2 text-sm">
              <Link href={`/checklists/${c.id}`} className="font-medium text-blue-700 hover:underline">{c.title}</Link>
              <span className="text-gray-600">{attachedTo(c)}</span>
              <span>{progressOf(c.items).label}</span>
            </li>
          ))}
        </ul>
      )}
      <NewChecklistForm templates={(templates ?? []).map((t) => ({ id: t.id as string, label: t.name as string }))} />
    </div>
  );
}

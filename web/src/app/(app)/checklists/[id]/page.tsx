import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { canEdit } from '@/lib/auth/permissions';
import { formatDate, formatDateTime } from '@/lib/format';
import { progressOf } from '@/lib/checklists/format';
import type { ChecklistItem } from '@/lib/checklists/types';
import { ItemRow } from './item-row';
import { AddItemsForm } from './add-items-form';
import { TitleForm } from './title-form';

/** Done / total as a bar the eye reads before the numbers. */
function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3 pt-1">
      <div className="h-2 w-40 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
        <div className={`h-full rounded-full ${done === total && total > 0 ? 'bg-ok' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
      </div>
      <span data-testid="checklist-progress" className="text-sm font-medium">{label}</span>
    </div>
  );
}

export default async function ChecklistPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requirePermission('checklists');
  const editable = canEdit(profile, 'checklists');
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const [{ data: checklist }, { data: organizers }] = await Promise.all([
    supabase
      .from('checklists')
      .select(`
        id, title,
        session:sessions(id, title, date, course_id),
        slot:surgery_slots(id, starts_at, patient:patients(id, full_name)),
        items:checklist_items(
          id, position, text, assignee_id, due_date, done_at,
          done_by_profile:profiles!checklist_items_done_by_fkey(full_name, email),
          assignee:profiles!checklist_items_assignee_id_fkey(full_name, email)
        )
      `)
      .eq('id', id)
      .maybeSingle(),
    // Tasks go to staff: delegate logins are not assignable (0037).
    supabase.from('profiles').select('user_id, full_name, email').eq('active', true).in('role', ['admin', 'organizer']).order('full_name'),
  ]);
  if (!checklist) notFound();
  const c = checklist as unknown as {
    id: string; title: string;
    session: { id: string; title: string; date: string; course_id: string } | null;
    slot: { id: string; starts_at: string; patient: { id: string; full_name: string } | null } | null;
    items: ChecklistItem[];
  };
  const items = [...c.items].sort((a, b) => a.position - b.position);
  const options = (organizers ?? []).map((o) => ({ id: o.user_id as string, label: (o.full_name || o.email) as string }));

  return (
    <div className="max-w-3xl space-y-4">
      <div className="space-y-1">
        <h1>{c.title}</h1>
        <p className="text-sm text-muted">
          {c.session && (
            <Link href={`/courses/${c.session.course_id}`} className="text-accent hover:underline">
              Session · {c.session.title} · {formatDate(c.session.date)}
            </Link>
          )}
          {c.slot && (
            <Link href={`/schedule?date=${new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(c.slot.starts_at))}`} className="text-accent hover:underline">
              Surgery · {c.slot.patient?.full_name} · {formatDateTime(c.slot.starts_at)}
            </Link>
          )}
          {!c.session && !c.slot && 'Standalone checklist'}
        </p>
        <Progress {...progressOf(items)} />
        {editable && <TitleForm id={c.id} title={c.title} />}
      </div>
      {/* Viewers see the same rows with every control disabled. */}
      <fieldset disabled={!editable} className="min-w-0">
        <ul className="card">
          {items.length === 0 && <li className="text-muted">No items yet.</li>}
          {items.map((item, i) => (
            <ItemRow key={item.id} item={item} checklistId={c.id} organizers={options} first={i === 0} last={i === items.length - 1} />
          ))}
        </ul>
      </fieldset>
      {editable && <AddItemsForm checklistId={c.id} />}
    </div>
  );
}

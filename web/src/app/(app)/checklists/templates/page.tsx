import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { canEdit } from '@/lib/auth/permissions';
import { SCOPE_LABELS } from '@/lib/checklists/format';
import type { ChecklistScope } from '@/lib/checklists/types';

export default async function TemplatesPage() {
  const profile = await requirePermission('checklists');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('checklist_templates')
    .select('id, name, applies_to, is_default, items:template_items(count)')
    .order('applies_to')
    .order('name');
  if (error) throw new Error('Could not load templates');
  const templates = (data ?? []) as unknown as { id: string; name: string; applies_to: ChecklistScope; is_default: boolean; items: { count: number }[] }[];
  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1>Checklist templates</h1>
        {canEdit(profile, 'checklists') && <Link href="/checklists/templates/new" className="btn">New template</Link>}
      </div>
      <ul className="card divide-y divide-line">
        {templates.length === 0 && <li className="text-muted">No templates yet.</li>}
        {templates.map((t) => (
          <li key={t.id} className="flex flex-wrap gap-x-6 py-2 text-sm">
            <Link href={`/checklists/templates/${t.id}`} className="font-medium text-accent hover:underline">{t.name}</Link>
            <span>{SCOPE_LABELS[t.applies_to]}</span>
            <span className="text-muted">{t.items[0]?.count ?? 0} items</span>
            {t.is_default && <span className="badge badge-accent">Attaches automatically</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { SCOPE_LABELS } from '@/lib/checklists/format';
import type { ChecklistScope } from '@/lib/checklists/types';

export default async function TemplatesPage() {
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Checklist templates</h1>
        <Link href="/checklists/templates/new" className="btn">New template</Link>
      </div>
      <ul className="card divide-y divide-gray-100">
        {templates.length === 0 && <li className="text-gray-600">No templates yet.</li>}
        {templates.map((t) => (
          <li key={t.id} className="flex flex-wrap gap-x-6 py-2 text-sm">
            <Link href={`/checklists/templates/${t.id}`} className="font-medium text-blue-700 hover:underline">{t.name}</Link>
            <span>{SCOPE_LABELS[t.applies_to]}</span>
            <span className="text-gray-600">{t.items[0]?.count ?? 0} items</span>
            {t.is_default && <span className="rounded bg-blue-50 px-1.5 text-xs text-blue-800">Attaches automatically</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

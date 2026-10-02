import { notFound } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { Template } from '@/lib/checklists/types';
import { TemplateForm } from '../template-form';
import { DeleteTemplate } from './delete-template';

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const { data } = await supabase
    .from('checklist_templates')
    .select('id, name, applies_to, is_default, items:template_items(text, position)')
    .eq('id', id)
    .maybeSingle();
  if (!data) notFound();
  const t = data as Template;
  t.items.sort((a, b) => a.position - b.position);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t.name}</h1>
      <ol className="card list-decimal space-y-1 pl-8 text-sm">
        {t.items.map((i) => <li key={i.position} data-testid="template-item">{i.text}</li>)}
      </ol>
      <TemplateForm key={t.items.map((i) => i.text).join('|')} template={t} />
      <DeleteTemplate id={t.id} />
    </div>
  );
}

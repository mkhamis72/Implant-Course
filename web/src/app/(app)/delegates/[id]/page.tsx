import { notFound } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { DelegateForm, type DelegateRow } from '../delegate-form';
import { updateDelegate } from '../actions';

export default async function DelegatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const { data } = await supabase
    .from('delegates')
    .select('id, full_name, phone, email, licence_no, notes, active')
    .eq('id', id)
    .maybeSingle();
  if (!data) notFound();
  const delegate = data as DelegateRow;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{delegate.full_name}</h1>
      <DelegateForm action={updateDelegate} delegate={delegate} />
    </div>
  );
}

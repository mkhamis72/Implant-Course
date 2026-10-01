import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import { formatConflict } from './conflict';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Who last changed this row, from the audit log — for "changed by … reload" messages. */
export async function staleMessage(supabase: Supabase, table: string, rowId: string): Promise<string> {
  const { data: last } = await supabase
    .from('audit_log')
    .select('at, user_id')
    .eq('table_name', table)
    .eq('row_id', rowId)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  let name: string | null = null;
  if (last?.user_id) {
    const { data: profile } = await supabase.from('profiles').select('full_name, email').eq('user_id', last.user_id).maybeSingle();
    name = profile?.full_name || profile?.email || null;
  }
  return formatConflict(name, last?.at ?? null);
}

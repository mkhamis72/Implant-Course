import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { ExportLog, type ExportLogRow } from '../export-panel';

/** Admins only: who exported what (research_exports). */
export default async function RecentExportsPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: log, error: logError }, courses, delegates, studies] = await Promise.all([
    supabase.from('research_exports').select('id, exported_by, exported_at, format, filters, row_counts').order('exported_at', { ascending: false }).limit(20),
    supabase.rpc('course_options'),
    supabase.from('delegates').select('id, full_name'),
    supabase.from('studies').select('id, title'),
  ]);
  const ids = [...new Set((log ?? []).map((r) => r.exported_by))];
  const { data: people } = ids.length ? await supabase.from('profiles').select('user_id, full_name').in('user_id', ids) : { data: [] };
  const names = new Map((people ?? []).map((p) => [p.user_id, p.full_name]));
  const rows = (log ?? []).map((r) => ({ ...r, exporter: names.get(r.exported_by) ?? null })) as ExportLogRow[];

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1>Recent exports</h1>
      </div>
      <ExportLog
        isAdmin
        rows={rows}
        failed={Boolean(logError)}
        courseNames={Object.fromEntries(((courses.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]))}
        delegateNames={Object.fromEntries((delegates.data ?? []).map((d) => [d.id, d.full_name]))}
        studyTitles={Object.fromEntries((studies.data ?? []).map((s) => [s.id, s.title]))}
      />
    </div>
  );
}

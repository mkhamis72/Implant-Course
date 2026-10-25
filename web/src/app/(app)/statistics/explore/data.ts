import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/research/export/fetch-all';
import { rpcArgs, type ResearchFilters } from '@/lib/research/view';
import type { LevelLabels } from '@/lib/analysis/choices';
import type { AnalysisData, ImplantRow, RadiographRow, VisitRow } from '@/lib/analysis/rows';

// PostgREST returns Postgres numeric as strings; the engine expects numbers (null stays null).
function numbers<T extends Record<string, unknown>>(rows: T[], keys: (keyof T)[]): T[] {
  return rows.map((r) => {
    const out = { ...r };
    for (const k of keys) if (out[k] !== null && out[k] !== undefined) out[k] = Number(out[k]) as T[keyof T];
    return out;
  });
}

const IMPLANT_NUMBERS: (keyof ImplantRow)[] = ['hba1c', 'diameter_mm', 'length_mm', 'torque_ncm', 'isq', 'keratinized_mucosa_mm'];
const VISIT_NUMBERS: (keyof VisitRow)[] = ['probing_max', 'isq', 'recession_facial_mm', 'recession_mesial_mm', 'recession_distal_mm'];
const XRAY_NUMBERS: (keyof RadiographRow)[] = ['mesial_mm', 'distal_mm', 'bone_change_mm'];

/** The Explore readers (0078) with the six research filters, and the names behind data-driven levels. */
export async function loadExplore(filters: ResearchFilters): Promise<{ data: AnalysisData; labels: LevelLabels }> {
  const supabase = await createClient();
  const args = rpcArgs(filters);
  const [implants, visits, radiographs, detail, delegates, supervisors, courses] = await Promise.all([
    fetchAll<ImplantRow>(supabase, 'analysis_implants', args, ['site_id']),
    fetchAll<VisitRow>(supabase, 'analysis_visits', args, ['visit_id']),
    fetchAll<RadiographRow>(supabase, 'analysis_radiographs', args, ['site_id', 'radiograph_id']),
    // Placing delegates' names for users who can't list delegates (as on Results).
    fetchAll<{ placing_delegate_id: string | null; placing_delegate: string | null }>(supabase, 'implant_outcomes_detail', args, ['site_id']),
    supabase.from('delegates').select('id, full_name'),
    supabase.from('supervisors').select('id, full_name'),
    supabase.rpc('course_options'),
  ]);
  if (implants.error || visits.error || radiographs.error || detail.error || delegates.error || supervisors.error || courses.error) {
    throw new Error('Could not load the clinical data');
  }
  const names = (rows: { id: string; full_name?: string; name?: string }[] | null) =>
    Object.fromEntries((rows ?? []).map((r) => [r.id, r.full_name ?? r.name ?? '']));
  const delegateNames = names(delegates.data);
  for (const r of detail.data ?? []) if (r.placing_delegate_id && r.placing_delegate) delegateNames[r.placing_delegate_id] = r.placing_delegate;
  return {
    data: {
      implants: numbers(implants.data ?? [], IMPLANT_NUMBERS),
      visits: numbers(visits.data ?? [], VISIT_NUMBERS),
      radiographs: numbers(radiographs.data ?? [], XRAY_NUMBERS),
    },
    labels: {
      delegate: delegateNames,
      supervisor: names(supervisors.data),
      course: names(courses.data as { id: string; name: string }[] | null),
    },
  };
}

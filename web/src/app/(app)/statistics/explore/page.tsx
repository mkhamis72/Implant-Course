import { requirePermission } from '@/lib/auth/session';
import { canEdit, canView } from '@/lib/auth/permissions';
import { createClient } from '@/lib/supabase/server';
import { readParams, type PageSearchParams } from '@/lib/search-params';
import { ALL_COURSES, RESEARCH_FILTER_KEYS } from '@/lib/research/view';
import { todayIso } from '@/lib/dates';
import { parseExplore } from '@/lib/analysis/url';
import { FilterForm } from '../filter-form';
import { NoPatientsNote } from '../research-view';
import { loadExplore } from './data';
import { ExploreWorkspace } from './workspace';
import type { SavedRow } from './saved-analyses';

const distinct = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));

export default async function ExplorePage({ searchParams }: { searchParams: PageSearchParams }) {
  const profile = await requirePermission('research');
  const header = (
    <div className="page-header">
      <div>
        <h1>Explore clinical data</h1>
        <p className="text-muted">Compare clinical variables and outcomes for the implants in the filter.</p>
      </div>
    </div>
  );
  // The readers are security invoker over patient tables: without Patients view every figure would read as zero.
  if (!canView(profile, 'patients')) {
    return <div className="space-y-6">{header}<NoPatientsNote /></div>;
  }

  const sp = await searchParams;
  const params = await readParams(searchParams, ...RESEARCH_FILTER_KEYS);
  // Analyses need sample size: Explore opens on All courses (Results opens on the latest course).
  const filters = { ...params, course: params.course || ALL_COURSES };
  const exploreParams = Object.fromEntries(
    Object.entries(sp).filter(([k]) => ['f', 'o', 'w', 'v'].includes(k) || k.startsWith('x_'))
      .map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  ) as Record<string, string | undefined>;

  const supabase = await createClient();
  const [{ data, labels }, saved] = await Promise.all([
    loadExplore(filters),
    supabase.from('saved_analyses')
      .select('id, title, config, course_id, created_by, created_at, creator:profiles!saved_analyses_created_by_fkey(full_name)')
      .order('created_at', { ascending: false }),
  ]);
  if (saved.error) throw new Error('Could not load the saved analyses');
  // course_options order (insertion order of the labels).
  const courseList = Object.entries(labels.course ?? {}).map(([id, name]) => ({ id, name }));
  const delegateOptions = Object.entries(labels.delegate ?? {}).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  const patients = Object.fromEntries(data.implants.map((r) => [r.site_id, { patientId: r.patient_id, fileNo: r.file_no, tooth: r.tooth }]));

  return (
    <div className="space-y-6">
      {header}
      <FilterForm filters={filters} courses={courseList} delegates={delegateOptions}
        brands={distinct([...data.implants.map((r) => r.brand), filters.brand])}
        systems={distinct([...data.implants.filter((r) => !filters.brand || r.brand === filters.brand).map((r) => r.system), filters.system])} />
      <ExploreWorkspace data={data} labels={labels} today={todayIso()} initial={parseExplore(exploreParams)}
        base={filters} patients={patients}
        saved={{ items: (saved.data ?? []) as unknown as SavedRow[], canEdit: canEdit(profile, 'research'), userId: profile.user_id,
          isAdmin: profile.role === 'admin', courses: labels.course ?? {} }} />
    </div>
  );
}

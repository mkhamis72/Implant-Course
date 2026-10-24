import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { canView } from '@/lib/auth/permissions';
import { readParams, type PageSearchParams } from '@/lib/search-params';
import { RESEARCH_FILTER_KEYS, defaultCourse, effectiveSystem } from '@/lib/research/view';
import { todayIso } from '@/lib/dates';
import { isCompareKey, needsGroupVars } from '@/lib/research/groups';
import { loadResearch } from './data';
import { FilterForm } from './filter-form';
import { ExportForm } from './export-panel';
import { NoPatientsNote, ResearchView } from './research-view';

const distinct = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => Boolean(v)))].sort();

export default async function StatisticsPage({ searchParams }: { searchParams: PageSearchParams }) {
  const profile = await requirePermission('research');
  const { compare: compareParam, ...params } = await readParams(searchParams, ...RESEARCH_FILTER_KEYS, 'compare');
  const compare = isCompareKey(compareParam) ? compareParam : null;
  const withGroups = needsGroupVars(compare);
  const header = (version: string | null) => (
    <div className="page-header">
      <div>
        <h1>Statistics & data analysis</h1>
        <p className="text-muted">
          Implant and crown outcomes for the implants placed in the filter{version && <> · <span className="badge">{version}</span></>}
        </p>
      </div>
    </div>
  );

  // The readers are security invoker over patient tables: without Patients view every figure would read as zero.
  if (!canView(profile, 'patients')) {
    return (
      <div className="space-y-6">
        {header(null)}
        <NoPatientsNote />
      </div>
    );
  }

  const supabase = await createClient();
  // Opens on the most recent course that has started; "All courses" is course=all.
  const courses = await supabase.rpc('course_options');
  if (courses.error) throw new Error('Could not load the courses');
  const courseRows = (courses.data ?? []) as { id: string; name: string; start_date: string }[];
  const requested = { ...params, course: params.course || defaultCourse(courseRows, todayIso()) };
  const [first, delegates, studies] = await Promise.all([
    loadResearch(requested, withGroups),
    supabase.from('delegates').select('id, full_name').order('full_name'),
    supabase.from('studies').select('id, title').order('title'),
  ]);
  if (studies.error) throw new Error('Could not load the studies');
  const studyList = (studies.data ?? []) as { id: string; title: string }[];

  // A line that isn't one of the selected brand's is dropped (and the figures reloaded without it).
  const system = effectiveSystem(requested.brand, requested.system, first.base);
  const filters = { ...requested, system, compare: compare ?? '' };
  const { version, rows, base, crowns, groups, consent } = system === requested.system ? first : await loadResearch(filters, withGroups);

  // Delegates the user can't list (no Delegates view) still appear when they placed an implant in range.
  const delegateNames = new Map<string, string>();
  for (const d of delegates.data ?? []) delegateNames.set(d.id, d.full_name);
  for (const r of base) if (r.placing_delegate_id && r.placing_delegate) delegateNames.set(r.placing_delegate_id, r.placing_delegate);
  const delegateOptions = [...delegateNames].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  const courseList = courseRows.map((c) => ({ id: c.id, name: c.name }));
  const brands = distinct([...base.map((r) => r.brand), filters.brand]);
  const systems = distinct([...base.filter((r) => !filters.brand || r.brand === filters.brand).map((r) => r.system), filters.system]);

  return (
    <div className="space-y-6">
      {header(version)}
      <FilterForm
        filters={filters}
        courses={courseList}
        delegates={delegateOptions}
        brands={brands}
        systems={systems}
      />
      <ResearchView rows={rows} crowns={crowns} filters={filters} groups={groups} consent={consent} noProduct={base.filter((r) => r.product_id === null).length} />
      <ExportForm filters={filters} studies={studyList} />
    </div>
  );
}

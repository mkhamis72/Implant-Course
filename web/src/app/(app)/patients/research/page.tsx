import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { canView } from '@/lib/auth/permissions';
import { readParams, type PageSearchParams } from '@/lib/search-params';
import { RESEARCH_FILTER_KEYS, effectiveSystem } from '@/lib/research/view';
import { isCompareKey, needsGroupVars } from '@/lib/research/groups';
import { loadResearch } from './data';
import { FilterForm } from './filter-form';
import { ExportForm, ExportLog, type ExportLogRow } from './export-panel';
import { NoPatientsNote, ResearchView } from './research-view';

const distinct = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => Boolean(v)))].sort();

export default async function ResearchPage({ searchParams }: { searchParams: PageSearchParams }) {
  const profile = await requirePermission('research');
  const { compare: compareParam, ...requested } = await readParams(searchParams, ...RESEARCH_FILTER_KEYS, 'compare');
  const compare = isCompareKey(compareParam) ? compareParam : null;
  const withGroups = needsGroupVars(compare);
  const header = (version: string | null) => (
    <div className="page-header">
      <div>
        <h1>Research</h1>
        <p className="text-muted">
          Implant and crown outcomes for the implants placed in the filter{version && <> · <span className="badge">{version}</span></>}
        </p>
      </div>
      <Link href="/patients" className="btn-secondary btn">Patients</Link>
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
  const [first, courses, delegates] = await Promise.all([
    loadResearch(requested, withGroups),
    supabase.rpc('course_options'),
    supabase.from('delegates').select('id, full_name').order('full_name'),
  ]);
  if (courses.error) throw new Error('Could not load the courses');

  // A line that isn't one of the selected brand's is dropped (and the figures reloaded without it).
  const system = effectiveSystem(requested.brand, requested.system, first.base);
  const filters = { ...requested, system, compare: compare ?? '' };
  const { version, rows, base, crowns, groups } = system === requested.system ? first : await loadResearch(filters, withGroups);

  const isAdmin = profile.role === 'admin';
  let exportLog: ExportLogRow[] = [];
  let exportLogFailed = false;
  if (isAdmin) {
    const { data: log, error: logError } = await supabase.from('research_exports').select('id, exported_by, exported_at, format, filters, row_counts').order('exported_at', { ascending: false }).limit(20);
    const ids = [...new Set((log ?? []).map((r) => r.exported_by))];
    const { data: people } = ids.length ? await supabase.from('profiles').select('user_id, full_name').in('user_id', ids) : { data: [] };
    const names = new Map((people ?? []).map((p) => [p.user_id, p.full_name]));
    exportLogFailed = Boolean(logError);
    exportLog = (log ?? []).map((r) => ({ ...r, exporter: names.get(r.exported_by) ?? null })) as ExportLogRow[];
  }

  // Delegates the user can't list (no Delegates view) still appear when they placed an implant in range.
  const delegateNames = new Map<string, string>();
  for (const d of delegates.data ?? []) delegateNames.set(d.id, d.full_name);
  for (const r of base) if (r.placing_delegate_id && r.placing_delegate) delegateNames.set(r.placing_delegate_id, r.placing_delegate);
  const delegateOptions = [...delegateNames].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  const courseList = ((courses.data ?? []) as { id: string; name: string }[]).map((c) => ({ id: c.id, name: c.name }));
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
      <ResearchView rows={rows} crowns={crowns} filters={filters} groups={groups} noProduct={base.filter((r) => r.product_id === null).length} />
      <ExportForm filters={filters} />
      <ExportLog
        isAdmin={isAdmin}
        rows={exportLog}
        failed={exportLogFailed}
        courseNames={Object.fromEntries(courseList.map((c) => [c.id, c.name]))}
        delegateNames={Object.fromEntries(delegateNames)}
      />
    </div>
  );
}

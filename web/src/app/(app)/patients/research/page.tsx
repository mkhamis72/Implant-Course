import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { canView } from '@/lib/auth/permissions';
import { readParams, type PageSearchParams } from '@/lib/search-params';
import { RESEARCH_FILTER_KEYS } from '@/lib/research/view';
import { loadResearch } from './data';
import { FilterForm } from './filter-form';
import { NoPatientsNote, ResearchView } from './research-view';

const distinct = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => Boolean(v)))].sort();

export default async function ResearchPage({ searchParams }: { searchParams: PageSearchParams }) {
  const profile = await requirePermission('research');
  const filters = await readParams(searchParams, ...RESEARCH_FILTER_KEYS);
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
  const [{ version, rows, base, crowns }, courses, delegates] = await Promise.all([
    loadResearch(filters),
    supabase.rpc('course_options'),
    supabase.from('delegates').select('id, full_name').order('full_name'),
  ]);
  if (courses.error) throw new Error('Could not load the courses');

  // Delegates the user can't list (no Delegates view) still appear when they placed an implant in range.
  const delegateNames = new Map<string, string>();
  for (const d of delegates.data ?? []) delegateNames.set(d.id, d.full_name);
  for (const r of base) if (r.placing_delegate_id && r.placing_delegate) delegateNames.set(r.placing_delegate_id, r.placing_delegate);
  const delegateOptions = [...delegateNames].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  const brands = distinct([...base.map((r) => r.brand), filters.brand]);
  const systems = distinct([...base.filter((r) => !filters.brand || r.brand === filters.brand).map((r) => r.system), filters.system]);

  return (
    <div className="space-y-6">
      {header(version)}
      <FilterForm
        filters={filters}
        courses={((courses.data ?? []) as { id: string; name: string }[]).map((c) => ({ id: c.id, name: c.name }))}
        delegates={delegateOptions}
        brands={brands}
        systems={systems}
      />
      <ResearchView rows={rows} crowns={crowns} filters={filters} noProduct={base.filter((r) => r.product_id === null).length} />
    </div>
  );
}

import Link from 'next/link';
import type { ReactNode } from 'react';
import { requirePermission } from '@/lib/auth/session';
import { canView } from '@/lib/auth/permissions';
import { teachingOn } from '@/lib/modules/modules';
import { createClient } from '@/lib/supabase/server';
import { readParams, type PageSearchParams } from '@/lib/search-params';
import { ALL_COURSES, RESEARCH_FILTER_KEYS, filterQuery, type ResearchFilters } from '@/lib/research/view';
import { thinWarning } from '@/lib/research/groups';
import { formatPct } from '@/lib/research/summary';
import { THIN_AT_RISK } from '@/lib/research/stats';
import { CONFIGURATION_LABELS, ARCH_LABELS, CASE_STATUS_LABELS } from '@/lib/full-arch/cases';
import type { CaseColumn, KmFigure } from '@/lib/research/full-arch';
import { formatDate } from '@/lib/format';
import { FilterForm } from '../filter-form';
import { CiText, Note, Warning } from '../compare-panel';
import { NoPatientsNote } from '../research-view';
import { loadFullArch } from './data';

const THIN_CASES = 30;
const ofN = (k: number, n: number) => (n === 0 ? '—' : `${k} of ${n}`);
const one = (n: number) => n.toFixed(1);

function Survival({ e }: { e: KmFigure | null }) {
  // A figure can exist without being usable (nobody followed this long): the dash, as on the Results tiles.
  if (!e || !e.defined) return <>—</>;
  return (
    <div className="space-y-0.5">
      <div>{formatPct(e.surv * 100)}</div>
      <div className="text-xs"><CiText e={e} /></div>
      <div className="text-xs text-muted">{`at risk ${e.nRisk}`}</div>
      {e.nRisk < THIN_AT_RISK && <div className="text-xs text-warn">{thinWarning(e.nRisk, e.events)}</div>}
    </div>
  );
}

function rowsOf(c: CaseColumn): { label: string; cell: ReactNode }[] {
  const none = c.cases === 0;
  const m = c.monthsToBridge;
  return [
    { label: 'Cases', cell: c.cases },
    { label: 'Reached the final bridge', cell: ofN(c.completed, c.cases) },
    { label: 'Months to final bridge (median, min–max)', cell: m.median === null || m.min === null || m.max === null ? '—' : `${one(m.median)} (${one(m.min)}–${one(m.max)})` },
    { label: 'Closed without completion', cell: ofN(c.closedIncomplete, c.cases) },
    { label: 'Cases with a bridge problem', cell: none ? '—' : `${c.withBridgeProblem} of ${c.cases} · ${c.bridgeProblems} problem${c.bridgeProblems === 1 ? '' : 's'} in total` },
    { label: 'Cases that lost an implant', cell: none ? '—' : `${c.lostImplant} of ${c.cases} · ${c.implantsFailed} failed of ${c.implantsPlaced} placed` },
    { label: 'Implants per case (median)', cell: c.medianImplants === null ? '—' : c.medianImplants },
    { label: 'Survival at 1 year', cell: <Survival e={c.survival12} /> },
    { label: 'Survival at 2 years', cell: <Survival e={c.survival24} /> },
  ];
}

export default async function FullArchPage({ searchParams }: { searchParams: PageSearchParams }) {
  const profile = await requirePermission('research');
  const params = await readParams(searchParams, ...RESEARCH_FILTER_KEYS);
  const header = (
    <div className="page-header">
      <div>
        <h1>Full arch</h1>
        <p className="text-muted">Full-arch cases by configuration, side by side. Counts describe each group; they are not a ranking.</p>
      </div>
    </div>
  );
  // The readers are security invoker over patient tables: without Patients view every figure would read as zero.
  if (!canView(profile, 'patients')) return <div className="space-y-6">{header}<NoPatientsNote /></div>;

  const teaching = teachingOn(profile.features);
  // Opens on All courses (cases are few). A clinic has no courses or delegates: those filters are ignored.
  const filters: ResearchFilters = teaching
    ? { ...params, course: params.course || ALL_COURSES }
    : { ...params, course: ALL_COURSES, delegate: '' };
  const supabase = await createClient();
  const [courses, delegates, data] = await Promise.all([
    supabase.rpc('course_options'),
    supabase.from('delegates').select('id, full_name').order('full_name'),
    loadFullArch(filters),
  ]);
  if (courses.error) throw new Error('Could not load the courses');
  const { columns, cases, planned, brands = [], systems = [] } = data;

  const courseList = ((courses.data ?? []) as { id: string; name: string }[]).map((c) => ({ id: c.id, name: c.name }));
  const delegateList = ((delegates.data ?? []) as { id: string; full_name: string }[]).map((d) => ({ id: d.id, name: d.full_name }));
  const q = filterQuery(filters);
  const curves = `/statistics?compare=case_type${q ? `&${q}` : ''}`;
  const thin = columns.filter((c) => c.cases > 0 && c.cases < THIN_CASES);
  const labels = rowsOf(columns[0]).map((r) => r.label);

  return (
    <div className="space-y-6">
      {header}
      <FilterForm filters={filters} courses={courseList} delegates={delegateList} teaching={teaching} brands={brands} systems={systems} />
      <section className="card space-y-3">
        <h2>Case types side by side</h2>
        {thin.map((c) => <Warning key={c.configuration}>{`${CONFIGURATION_LABELS[c.configuration]}: ${thinWarning(c.cases, c.implantsFailed)}`}</Warning>)}
        {planned > 0 && <Note>{`${planned} planned case${planned === 1 ? '' : 's'} without a placed implant ${planned === 1 ? 'is' : 'are'} not included.`}</Note>}
        <div className="overflow-x-auto">
          <table className="table" aria-label="Case types side by side">
            <thead>
              <tr>
                <th>Measure</th>
                {columns.map((c) => <th key={c.configuration}>{CONFIGURATION_LABELS[c.configuration]}</th>)}
              </tr>
            </thead>
            <tbody>
              {labels.map((label, i) => (
                <tr key={label}>
                  <td data-label="Measure">{label}</td>
                  {columns.map((c) => <td key={c.configuration} data-label={CONFIGURATION_LABELS[c.configuration]}>{rowsOf(c)[i].cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Link href={curves} className="text-accent hover:underline">Implant survival curves</Link>
      </section>
      <section className="card space-y-3">
        <h2>Cases</h2>
        {cases.length === 0 ? <p className="text-muted">No cases with a placed implant in this filter.</p> : (
          <div className="overflow-x-auto">
            <table className="table" aria-label="Cases">
              <thead>
                <tr><th>File no.</th><th>Arch</th><th>Case type</th><th>Status</th><th>First placement</th><th>Final bridge</th></tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.case_id}>
                    <td data-label="File no."><Link href={`/patients/${c.patient_id}?view=arch`} className="text-accent hover:underline">{c.file_no}</Link></td>
                    <td data-label="Arch">{ARCH_LABELS[c.arch]}</td>
                    <td data-label="Case type">{CONFIGURATION_LABELS[c.configuration]}</td>
                    <td data-label="Status">{CASE_STATUS_LABELS[c.status]}</td>
                    <td data-label="First placement">{c.first_placed_on ? formatDate(c.first_placed_on) : '—'}</td>
                    <td data-label="Final bridge">{c.finalBridgeOn ? formatDate(c.finalBridgeOn) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

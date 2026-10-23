import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth/session';
import { canView } from '@/lib/auth/permissions';
import { formatDate } from '@/lib/format';
import { readParams, type PageSearchParams } from '@/lib/search-params';
import {
  DRILLDOWN_TITLES, MILESTONE_LABELS, RESEARCH_FILTER_KEYS, filterQuery, gradeLabel, isCrownList, isDrilldownList,
  milestoneKey, selectCrowns, selectImplants, type DetailRow,
} from '@/lib/research/view';
import { loadResearch } from '../data';
import { NoPatientsNote } from '../research-view';

function implantStatus(list: string, r: DetailRow): string {
  if (list === 'biological') return `${r.biological_complications} biological complication${r.biological_complications === 1 ? '' : 's'}`;
  if (list === 'mechanical') return `${r.mechanical_complications} mechanical complication${r.mechanical_complications === 1 ? '' : 's'}`;
  const key = milestoneKey(list);
  if (key) return MILESTONE_LABELS[r[key]] ?? r[key];
  return `1 year: ${MILESTONE_LABELS[r.year_1] ?? r.year_1} · 2 years: ${MILESTONE_LABELS[r.year_2] ?? r.year_2}`;
}

function PatientCell({ id, name, fileNo }: { id: string; name: string | null; fileNo: string | null }) {
  return (
    <td data-label="Patient">
      <Link href={`/patients/${id}`} className="text-accent hover:underline">{name ?? 'Patient'}</Link>
      {fileNo && <span className="ml-2 text-sm text-muted">{fileNo}</span>}
    </td>
  );
}

export default async function ResearchDrilldownPage({ searchParams }: { searchParams: PageSearchParams }) {
  const profile = await requirePermission('research');
  const { list, ...filters } = await readParams(searchParams, 'list', ...RESEARCH_FILTER_KEYS, 'compare'); // compare: kept for the link back
  if (!isDrilldownList(list)) notFound();
  const query = filterQuery(filters);
  const header = (
    <div className="page-header">
      <div>
        <h1>{DRILLDOWN_TITLES[list]}</h1>
        <p className="text-muted">Research · the records behind the number</p>
      </div>
      <Link href={`/patients/research${query ? `?${query}` : ''}`} className="btn-secondary btn">Research</Link>
    </div>
  );
  if (!canView(profile, 'patients')) {
    return <div className="space-y-6">{header}<NoPatientsNote /></div>;
  }

  const { rows, base, crowns } = await loadResearch(filters);
  const crownRows = isCrownList(list) ? selectCrowns(list, crowns) : [];
  // A brand / type filter drops implants without a product, so that list reads the set before it.
  const implantRows = isCrownList(list) ? [] : selectImplants(list, list === 'no_product' ? base : rows);
  const count = isCrownList(list) ? crownRows.length : implantRows.length;

  return (
    <div className="space-y-6">
      {header}
      <div className="card overflow-x-auto">
        {count === 0 ? (
          <p className="text-muted">Nothing to list.</p>
        ) : isCrownList(list) ? (
          <table className="table">
            <thead>
              <tr><th>Patient</th><th>Teeth</th><th>Fitted</th><th>Status</th><th>Problems</th></tr>
            </thead>
            <tbody>
              {crownRows.map((c) => (
                <tr key={c.restoration_id} data-testid="drilldown-row">
                  <PatientCell id={c.patient_id} name={c.patient_name} fileNo={c.file_no} />
                  <td data-label="Teeth">{c.teeth.join(', ')}</td>
                  <td data-label="Fitted">{formatDate(c.fitted_on)}</td>
                  <td data-label="Status">{c.remade ? `Remade${c.remade_on ? ` ${formatDate(c.remade_on)}` : ''}` : 'In place'}</td>
                  <td data-label="Problems">{c.problems}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Patient</th><th>Tooth</th><th>Placed</th><th>Status</th><th>ICOI grade</th></tr>
            </thead>
            <tbody>
              {implantRows.map((r) => (
                <tr key={r.site_id} data-testid="drilldown-row">
                  <PatientCell id={r.patient_id} name={r.patient_name} fileNo={r.file_no} />
                  <td data-label="Tooth">{r.tooth}</td>
                  <td data-label="Placed">{formatDate(r.placed_on)}</td>
                  <td data-label="Status">{implantStatus(list, r)}</td>
                  <td data-label="ICOI grade">
                    {gradeLabel(r.latest_grade)}
                    {r.latest_grade_reason && <span className="block text-sm text-muted">{r.latest_grade_reason}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-sm text-muted">{count} {isCrownList(list) ? 'final restorations' : 'implants'}</p>
    </div>
  );
}

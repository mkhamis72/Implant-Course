import Link from 'next/link';
import type { ReactNode } from 'react';
import { complications, crownSummary, formatPct, icoiBreakdown, kaplanMeier, kmEstimate, survivalAt, type CrownRow } from '@/lib/research/summary';
import { THIN_AT_RISK } from '@/lib/research/stats';
import { CLUSTER_NOTE, groupRows, isCompareKey, thinWarning, unknownDateNote, type GroupVars } from '@/lib/research/groups';
import { GRADE_LABELS, drilldownHref, type DetailRow, type ResearchFilters } from '@/lib/research/view';
import { SurvivalChart, type Curve } from './survival-chart';
import { CiText, ComparePanel, Note, Warning } from './compare-panel';

const MONTH_DAYS = 30.4375;

export function NoPatientsNote() {
  return <p className="rounded-md bg-warn-soft p-3 text-sm text-warn">Research needs View on Patients to read the records</p>;
}

function Num({ list, filters, children }: { list: string; filters: ResearchFilters; children: ReactNode }) {
  return <Link href={drilldownHref(list, filters)} className="text-accent hover:underline">{children}</Link>;
}

function Tile({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="card space-y-1">
      <h2 className="text-sm font-medium text-muted">{title}</h2>
      {children}
    </section>
  );
}

// The KM estimate at 12 / 24 months (the same fit as the curve), its 95% CI and number at risk, then the SQL
// milestone breakdown with no % of its own. Thin = fewer than THIN_AT_RISK at risk at that point.
function SurvivalTile({ rows, year, filters }: { rows: DetailRow[]; year: 'year_1' | 'year_2'; filters: ResearchFilters }) {
  const e = kmEstimate(rows, year === 'year_1' ? 12 : 24);
  const s = survivalAt(rows, year);
  return (
    <Tile title={year === 'year_1' ? 'Survival at 1 year' : 'Survival at 2 years'}>
      {!e.defined ? (
        <>
          <p className="text-3xl font-semibold">—</p>
          <p className="text-sm text-muted">No implant followed this long yet</p>
        </>
      ) : (
        <>
          <p className="text-3xl font-semibold">{formatPct(e.surv * 100)}</p>
          <p className="text-sm"><CiText e={e} /></p>
          <p className="text-sm text-muted">{`at risk ${e.nRisk}`}</p>
        </>
      )}
      <p className="text-sm text-muted">
        Status at the milestone:{' '}
        <Num list={`${year}_survived`} filters={filters}>{s.survived} survived</Num> ·{' '}
        <Num list={`${year}_failed`} filters={filters}>{s.failed} failed</Num> ·{' '}
        <Num list={`${year}_not_reached`} filters={filters}>{s.notReached} not reached</Num> ·{' '}
        <Num list={`${year}_unknown`} filters={filters}>{s.unknown} lost to follow-up</Num>
      </p>
      {e.defined && e.nRisk < THIN_AT_RISK && <Warning>{thinWarning(e.nRisk, e.events)}</Warning>}
    </Tile>
  );
}

const GROUP_COLORS = ['accent', 'ok', 'warn', 'bad', 'ink', 'muted'].map((c) => `var(--color-${c})`);
const monthsOf = (rows: DetailRow[]) =>
  Math.max(0, ...rows.filter((r) => !r.event_time_unknown).map((r) => r.follow_up_days / MONTH_DAYS));

const GRADE_ORDER = ['I', 'II', 'III', 'IV', 'not_assessable', 'not_graded'] as const;
const GRADE_BAR: Record<(typeof GRADE_ORDER)[number], string> = {
  I: 'bg-ok', II: 'bg-accent', III: 'bg-warn', IV: 'bg-bad', not_assessable: 'bg-off', not_graded: 'bg-line-strong',
};

export function ResearchView({ rows, crowns, filters, groups = [], noProduct }: {
  rows: DetailRow[];
  crowns: CrownRow[];
  filters: ResearchFilters;
  /** implant_outcomes_groups rows, when the comparison needs them. */
  groups?: GroupVars[];
  /** Implants with no product in the set before the brand / type filter. */
  noProduct: number;
}) {
  const total = rows.length;
  const icoi = icoiBreakdown(rows);
  const comp = complications(rows);
  const crown = crownSummary(crowns);
  const km = kaplanMeier(rows);
  const endMonth = monthsOf(rows);
  const compare = isCompareKey(filters.compare) ? filters.compare : null;
  const grouped = compare ? groupRows(rows, groups, compare) : [];
  // Loading is a table only (survivor bias): no group curves.
  const byGroup = compare !== null && compare !== 'loading' && grouped.length > 0;
  const curves: Curve[] = byGroup
    ? grouped.map((g, i) => ({
        label: g.label,
        color: GROUP_COLORS[i % GROUP_COLORS.length],
        dashed: i >= GROUP_COLORS.length,
        points: kaplanMeier(g.rows).points,
        end: monthsOf(g.rows),
      }))
    : [{ label: 'All implants', color: GROUP_COLORS[0], points: km.points, end: endMonth }];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile title="Implants">
          <p className="text-3xl font-semibold"><Num list="implants" filters={filters}>{total}</Num></p>
          <p className="text-sm text-muted">placed in range</p>
        </Tile>
        <SurvivalTile rows={rows} year="year_1" filters={filters} />
        <SurvivalTile rows={rows} year="year_2" filters={filters} />
        <Tile title="Crowns remade">
          <p className="text-3xl font-semibold"><Num list="crowns_remade" filters={filters}>{crown.remade}</Num></p>
          <p className="text-sm text-muted">
            of <Num list="crowns" filters={filters}>{crown.finals} final restorations</Num>
            {crown.finals > 0 && ` (${formatPct((crown.remade / crown.finals) * 100)})`}
          </p>
        </Tile>
      </div>

      <Note>{CLUSTER_NOTE}</Note>

      {noProduct > 0 && (
        <p className="text-sm text-muted">
          <Num list="no_product" filters={filters}>{noProduct}</Num> implants have no product recorded
        </p>
      )}

      <section aria-label="Survival curve" className="card space-y-2">
        <h2>Implant survival (Kaplan–Meier)</h2>
        {km.points.length === 1 && endMonth === 0 ? (
          <p className="text-muted">No implants to plot.</p>
        ) : (
          <SurvivalChart curves={curves} band={byGroup ? [] : km.band} atRisk={km.atRisk} endMonth={endMonth} />
        )}
        {km.excludedUnknownTime > 0 && (
          <p className="text-sm text-muted">
            <Num list="km_excluded" filters={filters}>{unknownDateNote(km.excludedUnknownTime)}</Num>
          </p>
        )}
        <Note>{CLUSTER_NOTE}</Note>
      </section>

      <ComparePanel compare={compare} groups={grouped} filters={filters} />

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="ICOI success" className="card space-y-3">
          <h2>ICOI success (latest grade)</h2>
          <ul className="space-y-2">
            {GRADE_ORDER.map((g) => {
              const n = icoi[g];
              const pct = total === 0 ? null : (n / total) * 100;
              return (
                <li key={g} className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-2 text-sm">
                  <span>{GRADE_LABELS[g]}</span>
                  <span className="h-3 rounded bg-sunken" aria-hidden="true">
                    <span className={`block h-3 rounded ${GRADE_BAR[g]}`} style={{ width: `${pct ?? 0}%` }} />
                  </span>
                  <Num list={`icoi_${g}`} filters={filters}>{n} ({formatPct(pct)})</Num>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted">Not assessable and not yet graded are never counted as success.</p>
        </section>

        <section aria-label="Complications" className="card space-y-2 text-sm">
          <h2>Complications</h2>
          <p>
            <Num list="biological" filters={filters}>{comp.biological}</Num> of{' '}
            <Num list="implants" filters={filters}>{comp.implants}</Num> implants ({formatPct(comp.biologicalPct)}) had a biological complication
          </p>
          <p>
            <Num list="mechanical" filters={filters}>{comp.mechanical}</Num> of{' '}
            <Num list="implants" filters={filters}>{comp.implants}</Num> implants ({formatPct(comp.mechanicalPct)}) had a mechanical complication
          </p>
          <p>
            <Num list="crowns_problems" filters={filters}>{crown.problems}</Num> of{' '}
            <Num list="crowns" filters={filters}>{crown.finals}</Num> final restorations had a problem
          </p>
        </section>
      </div>
    </div>
  );
}

import Link from 'next/link';
import { requirePermission } from '@/lib/auth/session';
import { canView } from '@/lib/auth/permissions';
import { readParams, type PageSearchParams } from '@/lib/search-params';
import { ALL_COURSES, RESEARCH_FILTER_KEYS } from '@/lib/research/view';
import { todayIso } from '@/lib/dates';
import { formatDate } from '@/lib/format';
import { getBranding } from '@/lib/branding/get';
import { describeLabelled } from '@/lib/analysis/choices';
import { runAnalysis } from '@/lib/analysis/run';
import { windowLabel } from '@/lib/analysis/timepoints';
import { parseExplore } from '@/lib/analysis/url';
import { variable } from '@/lib/analysis/variables';
import { PrintButton } from '../../../schedule/pull-list/print-button';
import { NoPatientsNote } from '../../research-view';
import { chartOption, chartSummary, DEFAULT_PALETTE } from '../chart-options';
import { loadExplore } from '../data';
import { renderChartSvg } from '../render-svg';
import { ExploreReport } from '../report';

const CHART_VIEWS = new Set(['box', 'strip', 'scatter', 'bar_stacked', 'bar_grouped', 'km', 'trend']);

export default async function ExplorePrintPage({ searchParams }: { searchParams: PageSearchParams }) {
  const profile = await requirePermission('research');
  const back = (query: string) => (
    <div className="flex gap-3 print:hidden">
      <PrintButton />
      <Link href={`/statistics/explore?${query}`} className="btn-secondary btn">Back to Explore</Link>
    </div>
  );
  if (!canView(profile, 'patients')) return <div className="space-y-6"><h1>Explore clinical data</h1><NoPatientsNote /></div>;

  const sp = await searchParams;
  const params = await readParams(searchParams, ...RESEARCH_FILTER_KEYS);
  const filters = { ...params, course: params.course || ALL_COURSES };
  const raw = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;
  const state = parseExplore(raw);
  const query = new URLSearchParams(Object.entries(raw).filter((e): e is [string, string] => !!e[1] && e[0] !== 'alt')).toString();
  const ov = state.config.outcome ? variable(state.config.outcome) : undefined;
  if (!ov) return <div className="space-y-4">{back(query)}<p className="card">Choose an outcome on the Explore page first.</p></div>;
  const fv = state.config.factor ? variable(state.config.factor) : undefined;

  const today = todayIso();
  const [{ data, labels }, branding] = await Promise.all([loadExplore(filters), getBranding()]);
  const result = runAnalysis(data, state.config, today, labels);
  const view = state.view && result.views.includes(state.view) ? state.view : result.views[0];
  const altView = raw.alt === '1' ? result.views.find((v) => v !== view && CHART_VIEWS.has(v)) ?? null : null;
  const ctx = { palette: DEFAULT_PALETTE, unit: ov.unit, outcomeLabel: ov.label, factorLabel: fv?.label ?? null, levels: ov.levels };
  const draw = (v: typeof view | null) => {
    const option = v && result.included > 0 ? chartOption(v, result, ctx) : null;
    return option ? { svg: renderChartSvg(option), summary: chartSummary(v!, result, { outcome: ov.label, factor: fv?.label ?? null }) } : null;
  };
  const main = draw(view);
  const alt = draw(altView);

  const timed = ov.source !== 'implant';
  const sql = [
    `Course: ${filters.course === ALL_COURSES ? 'All courses' : labels.course?.[filters.course] ?? 'Unknown course'}`,
    filters.from && `Placed from ${formatDate(filters.from)}`,
    filters.to && `Placed to ${formatDate(filters.to)}`,
    filters.delegate && `Placing delegate: ${labels.delegate?.[filters.delegate] ?? 'Unknown'}`,
    filters.brand && `Brand: ${filters.brand}`,
    filters.system && `Line / type: ${filters.system}`,
  ].filter((x): x is string => !!x);

  return (
    <div className="space-y-4">
      {back(query)}
      <ExploreReport
        result={result}
        title={fv ? `${ov.label} by ${fv.label}` : ov.label}
        company={branding.name}
        generated={formatDate(today)}
        variables={[
          `Compare by: ${fv?.label ?? 'Nothing (all implants)'}`,
          `Outcome: ${ov.label}`,
          ...(timed ? [`Timepoint: ${state.config.window === 'all' ? 'All timepoints' : windowLabel(state.config.window)}`] : []),
        ]}
        population={[...sql, ...describeLabelled(state.config.filters, labels)]}
        outcomeLevels={ov.levels}
        unit={ov.unit}
        svg={main?.svg ?? null}
        summary={main?.summary ?? null}
        altSvg={alt?.svg ?? null}
        altSummary={alt?.summary ?? null}
      />
    </div>
  );
}

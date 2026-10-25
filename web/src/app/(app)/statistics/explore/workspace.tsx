'use client';

import { useEffect, useMemo, useState } from 'react';
import type { LevelLabels } from '@/lib/analysis/choices';
import { applyFilters, describeFilters } from '@/lib/analysis/filters';
import { trajectories } from '@/lib/analysis/observations';
import type { AnalysisData } from '@/lib/analysis/rows';
import { runAnalysis, type AnalysisConfig } from '@/lib/analysis/run';
import { windowLabel, type TimepointKey } from '@/lib/analysis/timepoints';
import { exploreQuery, type ExploreState } from '@/lib/analysis/url';
import { variable } from '@/lib/analysis/variables';
import { chartOption, chartSummary, type Palette } from './chart-options';
import { loadPalette } from './explore-chart-loader';
import { FilterChips } from './filter-chips';
import { QuestionCard } from './question-card';
import { ChartCard, Findings, Included, KeyNumbers, Quality, StatsTable, Underlying, ViewTabs, type PatientRef } from './results';

const FALLBACK: Palette = { series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'], ink: '#17262b', muted: '#55666b', line: '#d9e2df' };
const MAX_TRAJECTORIES = 200;

export function ExploreWorkspace({ data, labels, today, initial, base, patients }: {
  data: AnalysisData;
  labels: LevelLabels;
  today: string;
  initial: ExploreState;
  base: Record<string, string>;
  patients: Record<string, PatientRef>;
}) {
  const [state, setState] = useState<ExploreState>(initial);
  const [palette, setPalette] = useState<Palette>(FALLBACK);
  useEffect(() => { loadPalette().then(setPalette).catch(() => {}); }, []);

  const update = (next: ExploreState) => {
    setState(next);
    window.history.replaceState(null, '', exploreQuery(next, base));
  };
  const setConfig = (patch: Partial<AnalysisConfig>) => {
    const outcomeChanged = patch.outcome !== undefined && patch.outcome !== state.config.outcome;
    const factorChanged = patch.factor !== undefined && patch.factor !== state.config.factor;
    update({ config: { ...state.config, ...patch }, view: outcomeChanged || factorChanged ? null : state.view });
  };

  const { config } = state;
  const fv = config.factor ? variable(config.factor) : undefined;
  const ov = config.outcome ? variable(config.outcome) : undefined;
  const result = useMemo(() => (ov ? runAnalysis(data, config, today, labels) : null), [data, config, today, labels, ov]);
  const view = result ? (state.view && result.views.includes(state.view) ? state.view : result.views[0]) : null;

  const traj = useMemo(() => {
    if (view !== 'trajectories' || !ov?.measure) return undefined;
    const rows = applyFilters(data.implants, config.filters).slice(0, MAX_TRAJECTORIES);
    const sites = new Set(rows.map((r) => r.site_id));
    const t = trajectories({ implants: rows, visits: data.visits.filter((v) => sites.has(v.site_id)), radiographs: data.radiographs.filter((x) => sites.has(x.site_id)) }, ov.measure, today);
    return [...t.entries()].map(([siteId, w]) => ({
      label: patients[siteId] ? `${patients[siteId].fileNo} · ${patients[siteId].tooth}` : siteId,
      points: Object.entries(w).map(([window, o]) => ({ window: window as TimepointKey, value: o!.value as number })).filter((pt) => typeof pt.value === 'number'),
    }));
  }, [view, ov, data, config.filters, today, patients]);

  const option = result && view ? chartOption(view, result, {
    palette, unit: ov?.unit, outcomeLabel: ov!.label, factorLabel: fv?.label ?? null, levels: ov?.levels, trajectories: traj,
  }) : null;

  return (
    <div className="space-y-4">
      <QuestionCard config={config} onChange={setConfig} />
      <FilterChips filters={config.filters} rows={data.implants} labels={labels} onChange={(filters) => setConfig({ filters })} />
      {result && ov && view && (
        <>
          <p className="text-sm text-muted" aria-label="Current analysis">
            {[fv ? `Compare by ${fv.label}` : 'All implants', ov.label, ov.source !== 'implant' ? (config.window === 'all' ? 'All timepoints' : windowLabel(config.window)) : null,
              `${result.implants} implants, ${result.patients} patients`, ...describeFilters(config.filters)].filter(Boolean).join(' · ')}
          </p>
          {result.included === 0 ? (
            <section className="card space-y-2">
              <p className="font-semibold">No implants match these filters.</p>
              <Included r={result} />
            </section>
          ) : (
            <>
              <KeyNumbers r={result} />
              <ViewTabs views={result.views} view={view} onSelect={(v) => update({ ...state, view: v })} />
              {option
                ? <ChartCard option={option} summary={chartSummary(view, result, { outcome: ov.label, factor: fv?.label ?? null })} />
                : null}
              <div className="grid gap-4 lg:grid-cols-2">
                <Findings r={result} />
                <Quality r={result} />
              </div>
              <StatsTable r={result} levels={ov.levels} unit={ov.unit} />
              <Included r={result} />
              <Underlying r={result} patients={patients} levels={ov.levels} />
            </>
          )}
        </>
      )}
    </div>
  );
}

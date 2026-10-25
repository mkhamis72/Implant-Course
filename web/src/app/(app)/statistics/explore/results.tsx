'use client';

import { useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { MISSING_LABELS, type MissingReason } from '@/lib/analysis/observations';
import type { AnalysisResult } from '@/lib/analysis/run';
import type { View } from '@/lib/analysis/types';
import type { Level } from '@/lib/analysis/variables';
import { fmt } from '@/lib/analysis/wording';
import { formatP } from '@/lib/research/stats';
import type { EChartsOption } from 'echarts';
import { VIEW_NAMES } from './chart-options';
import { ExploreChartLoader } from './explore-chart-loader';
import { download, svgToPng } from './chart-download';

export type PatientRef = { patientId: string; fileNo: string; tooth: number };

const MISSING_ORDER: (MissingReason | 'factor_not_assessed')[] =
  ['pending', 'not_applicable', 'not_attended', 'not_measured', 'not_recorded', 'missing', 'factor_not_assessed'];
const missingLabel = (k: MissingReason | 'factor_not_assessed') => (k === 'factor_not_assessed' ? 'Factor not assessed' : MISSING_LABELS[k]);

function Tile({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="card space-y-1">
      <h3 className="text-sm text-muted">{title}</h3>
      <div className="text-lg font-semibold">{children}</div>
    </section>
  );
}

export function KeyNumbers({ r }: { r: AnalysisResult }) {
  const eligible = r.implants - (r.missing.pending ?? 0) - (r.missing.not_applicable ?? 0);
  return (
    <section aria-label="Key numbers" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Tile title="Implants">{r.implants}</Tile>
      <Tile title="With a valid value">{`${r.included} of ${eligible}`}</Tile>
      <Tile title="Patients">{r.patients}</Tile>
      <Tile title="Result">{r.test ? <>{r.test.name}<span className="block text-sm font-normal text-muted">{r.test.statistic} · {formatP(r.test.p)}</span></> : 'No test'}</Tile>
      <Tile title="Effect">
        {r.effect
          ? <>{fmt(r.effect.value)}<span className="block text-sm font-normal text-muted">{r.effect.name}{r.effect.lo !== undefined && ` · 95% CI ${fmt(r.effect.lo)} to ${fmt(r.effect.hi!)}`}</span></>
          : '—'}
      </Tile>
    </section>
  );
}

export function ViewTabs({ views, view, onSelect }: { views: View[]; view: View; onSelect: (v: View) => void }) {
  return (
    <div role="tablist" aria-label="Chart type" className="tabs">
      {views.map((v) => (
        <button key={v} type="button" role="tab" className="tab" aria-selected={v === view} onClick={() => onSelect(v)}>{VIEW_NAMES[v]}</button>
      ))}
    </div>
  );
}

type ChartHandle = { renderToSVGString(): string; getWidth(): number; getHeight(): number };

export function ChartCard({ option, summary, files }: { option: EChartsOption; summary: string; files: { svg: string; png: string } }) {
  const chart = useRef<ChartHandle | null>(null);
  const svg = () => chart.current?.renderToSVGString() ?? null;
  return (
    <section aria-label="Chart" className="card space-y-2 overflow-x-auto">
      <div className="min-w-[320px]">
        <ExploreChartLoader option={option} summary={summary} height={340} onReady={(c) => { chart.current = c; }} />
      </div>
      <div className="flex gap-2 print:hidden">
        <button type="button" className="btn-secondary btn py-1 text-sm" onClick={() => {
          const s = svg();
          if (s) download(new Blob([s], { type: 'image/svg+xml' }), files.svg);
        }}>Download SVG</button>
        <button type="button" className="btn-secondary btn py-1 text-sm" onClick={() => {
          const s = svg();
          if (s && chart.current) svgToPng(s, chart.current.getWidth(), chart.current.getHeight()).then((b) => download(b, files.png)).catch(() => {});
        }}>Download PNG</button>
      </div>
    </section>
  );
}

export function StatsTable({ r, levels, unit }: { r: AnalysisResult; levels?: Level[]; unit?: string }) {
  const numeric = r.groups.some((g) => g.stats);
  const label = (v: string) => levels?.find((l) => l.value === v)?.label ?? v;
  const u = unit ? ` ${unit}` : '';
  return (
    <section aria-label="Statistics" className="card space-y-2">
      <h3 className="font-semibold">Statistics by group</h3>
      <table className="table" aria-label="Statistics by group">
        <thead>
          <tr>
            <th>Group</th><th>Implants</th><th>Patients</th>
            {numeric ? <><th>Median (IQR)</th><th>Mean (SD)</th><th>Range</th></> : <th>Outcome</th>}
          </tr>
        </thead>
        <tbody>
          {r.groups.map((g) => (
            <tr key={g.level ?? 'none'}>
              <td data-label="Group">{g.label}{!g.tested && r.groups.length > 1 && <span className="ml-1 text-xs text-muted">(not tested)</span>}</td>
              <td data-label="Implants">{g.n}</td>
              <td data-label="Patients">{g.patients}</td>
              {numeric ? (
                <>
                  <td data-label="Median (IQR)">{g.stats ? `${fmt(g.stats.median)}${u} (${fmt(g.stats.q1)}–${fmt(g.stats.q3)})` : '—'}</td>
                  <td data-label="Mean (SD)">{g.stats ? `${fmt(g.stats.mean)}${g.stats.sd === null ? '' : ` (${fmt(g.stats.sd)})`}` : '—'}</td>
                  <td data-label="Range">{g.stats ? `${fmt(g.stats.min)}–${fmt(g.stats.max)}` : '—'}</td>
                </>
              ) : (
                <td data-label="Outcome">
                  {g.counts ? Object.entries(g.counts).map(([k, n]) => `${label(k)}: ${n} of ${g.n} (${g.n ? Math.round((n / g.n) * 100) : 0}%)`).join(' · ') : '—'}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {r.standardized && <p className="text-sm text-muted">{r.standardized.name}: {fmt(r.standardized.value)}</p>}
    </section>
  );
}

export function Findings({ r }: { r: AnalysisResult }) {
  return (
    <section aria-label="Findings" className="card space-y-2">
      <h3 className="font-semibold">What the data shows</h3>
      {r.findings.map((line) => <p key={line}>{line}</p>)}
      <p className="text-sm text-muted">{r.explain}</p>
    </section>
  );
}

export function Quality({ r }: { r: AnalysisResult }) {
  if (r.warnings.length === 0) return null;
  return (
    <section aria-label="Data quality" className="card space-y-2">
      <h3 className="font-semibold">Data quality</h3>
      <ul className="space-y-1">
        {r.warnings.map((w, i) => <li key={i} className="rule-warn text-sm">{w.group && <strong>{w.group}: </strong>}{w.text}</li>)}
      </ul>
    </section>
  );
}

export function Included({ r }: { r: AnalysisResult }) {
  const rows = MISSING_ORDER.filter((k) => (r.missing[k] ?? 0) > 0);
  return (
    <section aria-label="Included and excluded" className="card space-y-2 text-sm">
      <h3 className="font-semibold">Included and excluded</h3>
      <p>{r.included} of {r.implants} implants have a valid value.</p>
      {rows.length > 0 && (
        <ul className="space-y-0.5">
          {rows.map((k) => <li key={k} className="flex justify-between gap-4"><span>{missingLabel(k)}</span><span>{r.missing[k]}</span></li>)}
        </ul>
      )}
    </section>
  );
}

export function Underlying({ r, patients, levels }: { r: AnalysisResult; patients: Record<string, PatientRef>; levels?: Level[] }) {
  const [open, setOpen] = useState(false);
  const show = (y: number | string) => (typeof y === 'number' ? fmt(y) : levels?.find((l) => l.value === y)?.label ?? y);
  return (
    <section aria-label="Underlying data" className="card space-y-2">
      <button type="button" className="btn-secondary btn text-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide underlying data' : 'Show underlying data'}
      </button>
      {open && (
        <table className="table" aria-label="Underlying data">
          <thead><tr><th>File no.</th><th>Tooth</th><th>Group</th><th>Value</th></tr></thead>
          <tbody>
            {r.points.map((pt) => {
              const ref = patients[pt.siteId];
              return (
                <tr key={pt.siteId}>
                  <td data-label="File no.">{ref ? <Link href={`/patients/${ref.patientId}?tooth=${ref.tooth}`}>{ref.fileNo}</Link> : '—'}</td>
                  <td data-label="Tooth">{ref?.tooth ?? '—'}</td>
                  <td data-label="Group">{typeof pt.x === 'number' ? fmt(pt.x) : pt.x}</td>
                  <td data-label="Value">{show(pt.y)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

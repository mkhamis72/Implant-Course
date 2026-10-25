// ECharts options for each Explore view, built from an AnalysisResult. Pure, so every view is unit-tested; the chart
// component only renders them. Dataviz rules: groups on a category axis share one colour (the axis names them);
// multi-series charts take the categorical slots in fixed order, never cycled (past the sixth: muted); thin marks,
// recessive axes, tooltips confined to the chart.

import type { EChartsOption } from 'echarts'
import type { AnalysisResult } from '@/lib/analysis/run'
import { TIMEPOINTS, type TimepointKey } from '@/lib/analysis/timepoints'
import type { View } from '@/lib/analysis/types'
import type { Level } from '@/lib/analysis/variables'
import { fmt } from '@/lib/analysis/wording'

export type Palette = { series: string[]; ink: string; muted: string; line: string }

/** The validated chart colours (globals.css --color-chart-1…6) and the text/line tokens, for when the page has none. */
export const DEFAULT_PALETTE: Palette = {
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'], ink: '#17262b', muted: '#55666b', line: '#d9e2df',
}
export type ChartContext = {
  palette: Palette
  unit?: string
  outcomeLabel: string
  factorLabel: string | null
  /** Outcome level labels (categorical outcomes); values are shown capitalised otherwise. */
  levels?: Level[]
  trajectories?: { label: string; points: { window: TimepointKey; value: number }[] }[]
}

const VIEW_NAMES: Record<View, string> = {
  box: 'Box plot', strip: 'Distribution', scatter: 'Scatter', bar_stacked: 'Stacked bars', bar_grouped: 'Grouped bars',
  km: 'Survival curve', trend: 'Trend', trajectories: 'Each implant', summary: 'Summary', table: 'Table',
}

const round = (x: number) => Number(x.toFixed(6))
const colorAt = (p: Palette, i: number) => p.series[i] ?? p.muted
const withUnit = (x: number, unit?: string) => `${fmt(x)}${unit ? ` ${unit}` : ''}`

function frame(p: Palette, ctx: ChartContext) {
  const axis = { axisLine: { lineStyle: { color: p.line } }, axisLabel: { color: p.muted }, splitLine: { lineStyle: { color: p.line, opacity: 0.5 } } }
  return {
    axis,
    category: (data: string[], name?: string) => ({
      type: 'category' as const, data, name, nameLocation: 'middle' as const, nameGap: 28,
      ...axis, axisLabel: { color: p.muted, width: 96, overflow: 'truncate' as const, interval: 0 },
    }),
    value: (name: string, extra: object = {}) => ({ type: 'value' as const, name, nameLocation: 'middle' as const, nameGap: 40, ...axis, ...extra }),
    base: {
      animation: false,
      textStyle: { color: p.ink, fontFamily: 'inherit' },
      grid: { left: 56, right: 16, top: 32, bottom: 48, containLabel: true },
      tooltip: { confine: true, trigger: 'item' as const },
    },
    outcomeAxis: `${ctx.outcomeLabel}${ctx.unit ? ` (${ctx.unit})` : ''}`,
  }
}

function levelLabel(ctx: ChartContext, value: string): string {
  return ctx.levels?.find((l) => l.value === value)?.label ?? value.charAt(0).toUpperCase() + value.slice(1)
}

export function chartOption(view: View, r: AnalysisResult, ctx: ChartContext): EChartsOption | null {
  const p = ctx.palette
  const f = frame(p, ctx)
  const withStats = r.groups.filter((g) => g.stats)

  switch (view) {
    case 'box':
      return {
        ...f.base,
        xAxis: f.category(withStats.map((g) => g.label), ctx.factorLabel ?? undefined),
        yAxis: f.value(f.outcomeAxis),
        tooltip: {
          ...f.base.tooltip,
          formatter: (x: unknown) => {
            const i = (x as { dataIndex: number }).dataIndex
            const s = withStats[i].stats!
            return `${withStats[i].label} (n = ${s.n})<br>Median ${withUnit(s.median, ctx.unit)} · IQR ${fmt(s.q1)}–${fmt(s.q3)}<br>Range ${fmt(s.min)}–${fmt(s.max)}`
          },
        },
        series: [{
          type: 'boxplot',
          data: withStats.map((g) => [g.stats!.min, g.stats!.q1, g.stats!.median, g.stats!.q3, g.stats!.max].map(round)),
          itemStyle: { color: 'transparent', borderColor: colorAt(p, 0), borderWidth: 2 },
          boxWidth: [12, 40],
        }],
      }

    case 'strip': {
      const labels = r.groups.map((g) => g.label)
      return {
        ...f.base,
        xAxis: f.category(labels, ctx.factorLabel ?? undefined),
        yAxis: f.value(f.outcomeAxis),
        tooltip: { ...f.base.tooltip, formatter: (x: unknown) => { const d = (x as { data: [string, number] }).data; return `${d[0]}: ${withUnit(d[1], ctx.unit)}` } },
        series: [{
          type: 'scatter', symbolSize: 8,
          data: r.points.filter((pt) => typeof pt.y === 'number').map((pt) => [String(pt.x), round(pt.y as number)]),
          itemStyle: { color: colorAt(p, 0), opacity: 0.75, borderColor: '#fff', borderWidth: 1 },
        }],
      }
    }

    case 'scatter': {
      const pts = r.points.filter((pt) => typeof pt.x === 'number' && typeof pt.y === 'number') as { x: number; y: number }[]
      const xs = pts.map((pt) => pt.x)
      const lo = Math.min(...xs)
      const hi = Math.max(...xs)
      const line = r.line && pts.length ? [[lo, r.line.intercept + r.line.slope * lo], [hi, r.line.intercept + r.line.slope * hi]].map((pt) => pt.map(round)) : []
      return {
        ...f.base,
        xAxis: f.value(ctx.factorLabel ?? '', { scale: true }),
        yAxis: f.value(f.outcomeAxis, { scale: true }),
        dataZoom: [{ type: 'inside', xAxisIndex: 0 }, { type: 'inside', yAxisIndex: 0 }],
        series: [
          { type: 'scatter', symbolSize: 8, data: pts.map((pt) => [round(pt.x), round(pt.y)]), itemStyle: { color: colorAt(p, 0), opacity: 0.8, borderColor: '#fff', borderWidth: 1 } },
          { type: 'line', data: line, showSymbol: false, silent: true, lineStyle: { color: p.ink, width: 2, type: 'dashed' }, tooltip: { show: false } },
        ],
      }
    }

    case 'bar_stacked':
    case 'bar_grouped': {
      const groups = r.groups.filter((g) => g.counts)
      const levels = [...new Set(groups.flatMap((g) => Object.keys(g.counts!)))]
      const ordered = ctx.levels ? ctx.levels.map((l) => l.value).filter((v) => levels.includes(v)) : levels.sort()
      return {
        ...f.base,
        legend: { top: 0, textStyle: { color: p.ink } },
        xAxis: f.category(groups.map((g) => g.label), ctx.factorLabel ?? undefined),
        yAxis: f.value('% of implants', { max: 100 }),
        tooltip: {
          ...f.base.tooltip,
          formatter: (x: unknown) => {
            const { seriesName, data } = x as { seriesName: string; data: { k: number; n: number; value: number } }
            return `${seriesName}: ${data.k} of ${data.n} implants (${fmt(data.value)}%)`
          },
        },
        series: ordered.map((level, i) => ({
          type: 'bar' as const,
          name: levelLabel(ctx, level),
          ...(view === 'bar_stacked' ? { stack: 'total' } : {}),
          barMaxWidth: 40,
          itemStyle: { color: colorAt(p, i), borderColor: '#fff', borderWidth: 1, borderRadius: view === 'bar_grouped' ? [4, 4, 0, 0] : 0 },
          data: groups.map((g) => {
            const k = g.counts![level] ?? 0
            return { value: g.n ? round((k / g.n) * 100) : 0, k, n: g.n }
          }),
        })),
      }
    }

    case 'km':
      if (!r.survival?.length) return null
      return {
        ...f.base,
        legend: { top: 0, textStyle: { color: p.ink } },
        tooltip: { ...f.base.tooltip, trigger: 'axis' },
        xAxis: f.value('Months since placement', { min: 0 }),
        yAxis: f.value('Implants surviving (%)', { min: 0, max: 100 }),
        series: (r.survival ?? []).map((c, i) => ({
          type: 'line' as const, name: c.label, step: 'end' as const, showSymbol: false,
          itemStyle: { color: colorAt(p, i) }, lineStyle: { width: 2, color: colorAt(p, i) },
          data: [[0, 100], ...c.fit.times.map((t, j) => [round(t), round(c.fit.surv[j] * 100)])],
        })),
      }

    case 'trend': {
      const windows = TIMEPOINTS.filter((t) => r.trend?.some((x) => x.window === t.key))
      const labels = [...new Set((r.trend ?? []).map((x) => x.label))]
      return {
        ...f.base,
        legend: { top: 0, textStyle: { color: p.ink } },
        tooltip: { ...f.base.tooltip, trigger: 'axis' },
        xAxis: f.category(windows.map((w) => w.label), 'Follow-up'),
        yAxis: f.value(`Median ${f.outcomeAxis}`, { scale: true }),
        series: labels.map((label, i) => ({
          type: 'line' as const, name: label, symbolSize: 8,
          itemStyle: { color: colorAt(p, i) }, lineStyle: { width: 2, color: colorAt(p, i) },
          data: windows.map((w) => {
            const x = r.trend!.find((t) => t.label === label && t.window === w.key)
            return x ? round(x.median) : null
          }),
        })),
      }
    }

    case 'trajectories': {
      const windows = TIMEPOINTS.filter((t) => ctx.trajectories?.some((tr) => tr.points.some((pt) => pt.window === t.key)))
      return {
        ...f.base,
        xAxis: f.category(windows.map((w) => w.label), 'Follow-up'),
        yAxis: f.value(f.outcomeAxis, { scale: true }),
        series: (ctx.trajectories ?? []).map((tr) => ({
          type: 'line' as const, name: tr.label, showSymbol: true, symbolSize: 4, connectNulls: true,
          itemStyle: { color: p.muted }, lineStyle: { color: p.muted, width: 1 }, emphasis: { lineStyle: { width: 2 } },
          data: windows.map((w) => { const pt = tr.points.find((x) => x.window === w.key); return pt ? round(pt.value) : null }),
        })),
      }
    }

    default:
      return null
  }
}

export function chartSummary(view: View, r: AnalysisResult, labels: { outcome: string; factor: string | null }): string {
  const groups = r.groups.filter((g) => g.tested).length || r.groups.length
  const head = `${VIEW_NAMES[view]} of ${labels.outcome}`
  return labels.factor
    ? `${head} by ${labels.factor}: ${groups} groups, ${r.included} implants.`
    : `${head}: ${r.included} implants.`
}

export { VIEW_NAMES }

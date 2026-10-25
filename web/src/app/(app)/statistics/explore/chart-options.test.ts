import { describe, expect, it } from 'vitest'
import type { AnalysisData, ImplantRow } from '@/lib/analysis/rows'
import { runAnalysis, type AnalysisConfig } from '@/lib/analysis/run'
import { implantRow, radiographRow } from '@/lib/analysis/test-rows'
import { chartOption, chartSummary, type Palette } from './chart-options'

const TODAY = '2026-09-02'
const palette: Palette = { series: ['#c1', '#c2', '#c3', '#c4', '#c5', '#c6'], ink: '#ink', muted: '#muted', line: '#line' }
const SMOKING = ['never', 'never', 'never', 'never', 'current', 'current', 'current', 'current', null]
const BONE = [0.2, 0.3, 0.4, 0.5, 0.8, 0.9, 1.0, 1.1, 0.5]

function data(over: (i: number) => Partial<ImplantRow> = () => ({})): AnalysisData {
  return {
    implants: SMOKING.map((s, i) => implantRow({ site_id: `s${i}`, patient_id: `p${i}`, smoking: s, isq: 60 + i, ...over(i) })),
    visits: [],
    radiographs: BONE.map((b, i) => radiographRow({ site_id: `s${i}`, radiograph_id: `x${i}`, days_since_placement: 365, mesial_mm: 1, distal_mm: 1, bone_change_mm: b })),
  }
}
const run = (config: Partial<AnalysisConfig>, d = data()) =>
  runAnalysis(d, { factor: 'smoking', outcome: 'bone_change', window: 'm12', filters: [], ...config }, TODAY)
const ctx = { palette, unit: 'mm', outcomeLabel: 'Marginal bone change', factorLabel: 'Smoking' }

function hasNaN(x: unknown): boolean {
  if (typeof x === 'number') return !Number.isFinite(x)
  if (Array.isArray(x)) return x.some(hasNaN)
  if (x && typeof x === 'object') return Object.values(x).some(hasNaN)
  return false
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const series = (o: any) => o.series as any[]

describe('chartOption', () => {
  const numeric = run({})

  it('box: one boxplot of min, Q1, median, Q3, max per group, in one colour', () => {
    const o = chartOption('box', numeric, ctx)!
    expect(series(o)).toHaveLength(1)
    expect(series(o)[0].type).toBe('boxplot')
    expect(series(o)[0].data[0]).toEqual([0.2, 0.275, 0.35, 0.425, 0.5])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((o as any).xAxis.data).toEqual(['Never', 'Current', 'Not assessed'])
    expect(series(o)[0].itemStyle.borderColor).toBe('#c1')
  })

  it('strip: one scatter point per included implant', () => {
    expect(series(chartOption('strip', numeric, ctx))[0].data).toHaveLength(numeric.included)
  })

  it('scatter: points, the least-squares line and inside zoom', () => {
    const r = run({ factor: 'isq_placement' })
    const o = chartOption('scatter', r, { ...ctx, factorLabel: 'ISQ at placement' })!
    expect(series(o).map((s) => s.type)).toEqual(['scatter', 'line'])
    expect(series(o)[1].data).toHaveLength(2)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((o as any).dataZoom.every((z: { type: string }) => z.type === 'inside')).toBe(true)
  })

  it('stacked and grouped bars: percentages of each group, with counts in the tooltip', () => {
    const r = run({ factor: 'jaw', outcome: 'failed' }, data((i) => ({ tooth: i < 4 ? 16 : 36, event: i === 5 })))
    const stacked = chartOption('bar_stacked', r, { ...ctx, factorLabel: 'Jaw', outcomeLabel: 'Implant failure' })!
    expect(series(stacked).every((s) => s.type === 'bar' && s.stack === 'total')).toBe(true)
    const yes = series(stacked).find((s) => s.name === 'Yes')
    expect(yes.data.map((d: { value: number }) => d.value)).toEqual([0, 20])
    expect(yes.data[1].k).toBe(1)
    expect(yes.data[1].n).toBe(5)
    const grouped = chartOption('bar_grouped', r, { ...ctx, factorLabel: 'Jaw', outcomeLabel: 'Implant failure' })!
    expect(series(grouped).some((s) => s.stack)).toBe(false)
  })

  it('km: a step line per curve from 100% at time 0, in palette order', () => {
    const r = run({ outcome: 'survival' }, data((i) => (i === 5 ? { event: true, event_on: '2025-07-29', follow_up_days: 200 } : {})))
    const o = chartOption('km', r, ctx)!
    expect(series(o).map((s) => [s.type, s.step, s.data[0]])).toEqual([['line', 'end', [0, 100]], ['line', 'end', [0, 100]]])
    expect(series(o).map((s) => s.itemStyle.color)).toEqual(['#c1', '#c2'])
  })

  it('trend: a line per group over the timepoints', () => {
    const o = chartOption('trend', run({ window: 'all' }), ctx)!
    expect(series(o).map((s) => s.name)).toEqual(['Never', 'Current', 'Not assessed'])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((o as any).xAxis.data).toContain('12 months')
  })

  it('trajectories: a thin muted line per implant', () => {
    const o = chartOption('trajectories', run({ window: 'all' }), {
      ...ctx, trajectories: [{ label: 'F1 · 36', points: [{ window: 'm6', value: 0.2 }, { window: 'm12', value: 0.4 }] }],
    })!
    expect(series(o)[0]).toMatchObject({ type: 'line', lineStyle: { color: '#muted', width: 1 } })
  })

  it('km is not a chart when there are no curves (a factor that cannot be split)', () => {
    expect(chartOption('km', run({ factor: 'torque', outcome: 'survival' }, data(() => ({ torque_ncm: 35 }))), ctx)).toBeNull()
  })

  it('summary and table are not charts', () => {
    expect(chartOption('summary', numeric, ctx)).toBeNull()
    expect(chartOption('table', numeric, ctx)).toBeNull()
  })

  it('never cycles colours: groups past the sixth are muted', () => {
    const many = run({ factor: 'tooth', outcome: 'survival' }, data((i) => ({ tooth: 11 + i })))
    const colors = series(chartOption('km', many, ctx)).map((s) => s.itemStyle.color)
    expect(colors.slice(0, 6)).toEqual(palette.series)
    expect(colors.slice(6).every((c) => c === '#muted')).toBe(true)
  })

  it('has no NaN, truncates long category labels and keeps tooltips inside the chart', () => {
    for (const view of ['box', 'strip'] as const) {
      const o = chartOption(view, numeric, ctx)!
      expect(hasNaN(o)).toBe(false)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((o as any).xAxis.axisLabel).toMatchObject({ width: 96, overflow: 'truncate' })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((o as any).tooltip.confine).toBe(true)
    }
  })
})

describe('tooltips', () => {
  it('escapes user-entered names in every tooltip (no HTML from a delegate or brand name)', () => {
    const evil = '<img src=x onerror=alert(1)>'
    const d = data((i) => ({ placing_delegate_id: i < 4 ? 'd1' : 'd2', event: i === 5 }))
    const labels = { delegate: { d1: evil, d2: 'Dr A & B' } }
    const tip = (o: unknown, params: unknown) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((o as any).tooltip.formatter as (p: unknown) => string)(params)
    const numeric = runAnalysis(d, { factor: 'delegate', outcome: 'bone_change', window: 'm12', filters: [] }, TODAY, labels)
    const box = chartOption('box', numeric, ctx)!
    const evilIndex = numeric.groups.filter((g) => g.stats).findIndex((g) => g.label === evil)
    expect(tip(box, { dataIndex: evilIndex })).not.toContain('<img')
    expect(tip(box, { dataIndex: evilIndex })).toContain('&lt;img')
    expect(tip(chartOption('strip', numeric, ctx), { data: [evil, 0.3] })).not.toContain('<img')
    const counts = runAnalysis(d, { factor: 'delegate', outcome: 'failed', window: 'm12', filters: [] }, TODAY, labels)
    const bars = chartOption('bar_stacked', counts, { ...ctx, levels: [{ value: 'yes', label: evil }] })!
    expect(tip(bars, { seriesName: evil, data: { k: 1, n: 2, value: 50 } })).not.toContain('<img')
  })
})

describe('chartSummary', () => {
  it('describes the chart in one sentence', () => {
    expect(chartSummary('box', run({}), { outcome: 'Marginal bone change', factor: 'Smoking' }))
      .toBe('Box plot of Marginal bone change by Smoking: 2 groups, 9 implants.')
    expect(chartSummary('summary', run({ factor: null }), { outcome: 'Marginal bone change', factor: null }))
      .toBe('Summary of Marginal bone change: 9 implants.')
  })
})

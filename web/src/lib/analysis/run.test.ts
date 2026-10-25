import { describe, expect, it } from 'vitest'
import { CLUSTER_NOTE } from '@/lib/research/groups'
import type { AnalysisData, ImplantRow } from './rows'
import { runAnalysis, type AnalysisResult } from './run'
import { implantRow, radiographRow } from './test-rows'
import { CAUSATION } from './wording'

const TODAY = '2026-09-02' // 600 days after the placements below
const PATIENTS = ['p1', 'p1', 'p2', 'p2', 'p3', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9']
const SMOKING = ['never', 'never', 'never', 'never', 'never', 'current', 'current', 'current', 'current', 'current', null, null]
// 12-month bone change (null = an X-ray without levels; undefined = no X-ray).
const BONE: (number | null | undefined)[] = [0.2, 0.3, 0.4, 0.5, undefined, 0.8, 0.9, 1.0, 1.1, null, 0.5, undefined]

function fixture(over: (i: number) => Partial<ImplantRow> = () => ({}), bone = BONE): AnalysisData {
  const implants = PATIENTS.map((p, i) => implantRow({ site_id: `s${i + 1}`, patient_id: p, smoking: SMOKING[i], ...over(i) }))
  const radiographs = bone.flatMap((b, i) => b === undefined ? [] : [radiographRow({
    site_id: `s${i + 1}`, radiograph_id: `x${i + 1}`, days_since_placement: 365, taken_on: '2026-01-10',
    mesial_mm: b === null ? null : 1, distal_mm: b === null ? null : 1, bone_change_mm: b,
  })])
  return { implants, visits: [], radiographs }
}
const withEvent = (i: number): Partial<ImplantRow> => (i === 11 ? { event: true, event_on: '2025-04-20', follow_up_days: 100 } : {})

function hasNaN(x: unknown): boolean {
  if (typeof x === 'number') return !Number.isFinite(x)
  if (Array.isArray(x)) return x.some(hasNaN)
  if (x && typeof x === 'object') return Object.values(x).some(hasNaN)
  return false
}
const reasonsTotal = (r: AnalysisResult) =>
  Object.entries(r.missing).filter(([k]) => k !== 'factor_not_assessed').reduce((s, [, n]) => s + (n ?? 0), 0)

describe('runAnalysis', () => {
  it('smoking → 12-month bone change: groups, rank test, mean difference, missing reasons, warnings, findings', () => {
    const r = runAnalysis(fixture(withEvent), { factor: 'smoking', outcome: 'bone_change', window: 'm12', filters: [] }, TODAY)
    expect(r.method).toBe('numeric_by_group')
    expect(r.views[0]).toBe('box')
    expect(r.groups.map((g) => [g.label, g.n, g.tested])).toEqual([['Never', 4, true], ['Current', 4, true], ['Not assessed', 1, false]])
    expect(r.test!.name).toBe('Mann–Whitney U')
    expect(r.test!.p).toBeCloseTo(2 / 70, 10) // exact, as wilcox.test with 4 vs 4 and no ties
    expect(r.effect!.name).toBe('Mean difference (Current − Never)')
    expect(r.effect!.value).toBeCloseTo(0.6, 10)
    expect(r.missing).toMatchObject({ missing: 1, not_measured: 1, not_applicable: 1 })
    expect(reasonsTotal(r)).toBe(r.implants - r.included)
    expect([r.implants, r.patients, r.included]).toEqual([12, 9, 9])
    expect(r.warnings.filter((w) => w.kind === 'small_group').map((w) => w.group)).toEqual(['Never', 'Current'])
    expect(r.warnings.map((w) => w.text)).toContain(CLUSTER_NOTE)
    expect(r.findings[0]).toBe('Marginal bone change was higher in the Current group in this dataset (median 0.95 vs 0.35 mm).')
    expect(r.findings.at(-1)).toBe(CAUSATION)
    expect(hasNaN(r)).toBe(false)
  })

  it('orders people by name, never by result', () => {
    const data = fixture((i) => ({ placing_delegate_id: i < 6 ? 'd1' : 'd2', event: i >= 6 && i < 9 }))
    const r = runAnalysis(data, { factor: 'delegate', outcome: 'failed', window: 'm12', filters: [] }, TODAY,
      { delegate: { d1: 'Zed Delegate', d2: 'Amy Delegate' } })
    expect(r.method).toBe('categorical_by_group')
    expect(r.groups.map((g) => g.label)).toEqual(['Amy Delegate', 'Zed Delegate'])
    expect(r.groups[0].counts).toEqual({ yes: 3, no: 3 })
    expect(r.warnings.some((w) => w.kind === 'operator')).toBe(true)
  })

  it('smoking → survival: one curve per tested group, log-rank, unknown event times left out', () => {
    const data = fixture((i) => ({
      ...(i === 5 ? { event: true, event_on: '2025-07-29', follow_up_days: 200 } : {}),
      ...(i === 6 ? { event: true, event_on: '2025-11-06', follow_up_days: 300 } : {}),
      ...(i === 0 ? { event: true, event_on: null, event_time_unknown: true } : {}),
    }))
    const r = runAnalysis(data, { factor: 'smoking', outcome: 'survival', window: 'm12', filters: [] }, TODAY)
    expect(r.method).toBe('survival')
    expect(r.survival!.map((s) => s.label)).toEqual(['Never', 'Current'])
    expect(r.survival![0].at12).toBe(1)
    expect(r.test!.name).toBe('Log-rank')
    expect(r.missing.not_applicable).toBe(1)
    expect(hasNaN(r)).toBe(false)
  })

  it('a filtered-out level is absent and nothing is tested', () => {
    const r = runAnalysis(fixture(), { factor: 'smoking', outcome: 'bone_change', window: 'm12',
      filters: [{ key: 'smoking', values: ['current'] }] }, TODAY)
    expect(r.groups.map((g) => g.label)).toEqual(['Current'])
    expect(r.test).toBeNull()
    expect(r.effect).toBeNull()
    expect(r.warnings.some((w) => w.kind === 'insufficient')).toBe(true)
    expect(hasNaN(r)).toBe(false)
  })

  it('a constant outcome has no effect size and reads as similar', () => {
    const r = runAnalysis(fixture(() => ({}), BONE.map((b) => (typeof b === 'number' ? 0 : b))),
      { factor: 'smoking', outcome: 'bone_change', window: 'm12', filters: [] }, TODAY)
    expect(r.effect).toBeNull()
    expect(r.standardized).toBeNull()
    expect(r.findings[0]).toContain('was similar in the Never and Current groups')
    expect(hasNaN(r)).toBe(false)
  })

  it('a continuous factor that cannot be split gives no curves and says why', () => {
    const r = runAnalysis(fixture(() => ({ torque_ncm: 35 })), { factor: 'torque', outcome: 'survival', window: 'm12', filters: [] }, TODAY)
    expect(r.survival).toBeNull()
    expect(r.test).toBeNull()
    expect(r.warnings.map((w) => w.text)).toContain('Insertion torque has too few distinct values to split into groups.')
  })

  it('splits a continuous factor at the median for survival', () => {
    const r = runAnalysis(fixture((i) => ({ torque_ncm: 20 + i * 5 })), { factor: 'torque', outcome: 'survival', window: 'm12', filters: [] }, TODAY)
    expect(r.survival!.map((s) => s.label)).toEqual(['Insertion torque ≤ 47.5 Ncm', 'Insertion torque > 47.5 Ncm'])
  })

  it('ISQ at placement → bone change is a correlation with a trend line', () => {
    const r = runAnalysis(fixture((i) => ({ isq: 60 + i })), { factor: 'isq_placement', outcome: 'bone_change', window: 'm12', filters: [] }, TODAY)
    expect(r.method).toBe('correlation')
    expect(r.points).toHaveLength(9)
    expect(r.line).not.toBeNull()
    expect(r.standardized!.name).toBe('Spearman ρ')
    expect(r.effect!.name).toBe('Pearson r')
  })

  it('all windows with a measurement outcome is a trend; no factor is a summary', () => {
    const t = runAnalysis(fixture(), { factor: 'smoking', outcome: 'bone_change', window: 'all', filters: [] }, TODAY)
    expect(t.method).toBe('trend')
    expect(t.trend!.filter((x) => x.window === 'm12').map((x) => [x.label, x.n, x.median]))
      .toEqual([['Never', 4, 0.35], ['Current', 4, 0.95], ['Not assessed', 1, 0.5]])
    const d = runAnalysis(fixture(), { factor: null, outcome: 'bone_change', window: 'm12', filters: [] }, TODAY)
    expect(d.method).toBe('describe')
    expect(d.groups.map((g) => [g.label, g.n])).toEqual([['All implants', 9]])
    expect(d.findings.includes(CAUSATION)).toBe(false)
  })
})

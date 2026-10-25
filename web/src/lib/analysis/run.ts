// One Explore analysis: filter the implants, read the factor and the outcome, pick the method (choose.ts), compute
// group summaries, the basic test and effect sizes, then warnings and plain-language findings.

import { kmFit, logRank, survivalAtTime, type SurvivalRow } from '@/lib/research/stats'
import { choose } from './choose'
import { applyFilters, levelLabel, NOT_ASSESSED, type Filter } from './filters'
import { observe, trajectories } from './observations'
import { conflictCount, MIN_TESTED, warningsFor, type Warning } from './quality'
import type { AnalysisData, ImplantRow } from './rows'
import {
  chiSquare, describe, fisher2x2, hedgesG, kruskalWallis, mannWhitney, ols, pearson, riskDifference, spearman, welch,
} from './tests'
import { TIMEPOINTS, type TimepointKey, type Window, windowRange } from './timepoints'
import type { Effect, GroupSummary, Method, Missing, SurvivalCurve, TestResult, TrendPoint, View } from './types'
import { sortsByLabel, variable, type Variable } from './variables'
import { findingsFor, fmt } from './wording'

export type AnalysisConfig = { factor: string | null; outcome: string; window: Window | 'all'; filters: Filter[] }
/** Labels for data-driven levels (delegates, courses, …), by variable key then value. */
export type LevelLabels = Record<string, Record<string, string>>

export type AnalysisResult = {
  method: Method
  views: View[]
  explain: string
  implants: number
  patients: number
  included: number
  missing: Missing
  groups: GroupSummary[]
  test: TestResult | null
  effect: Effect | null
  /** Hedges g (two numeric groups) or Spearman ρ (correlation). */
  standardized: Effect | null
  survival: SurvivalCurve[] | null
  points: { siteId: string; x: number | string; y: number | string }[]
  line: { intercept: number; slope: number } | null
  trend: TrendPoint[] | null
  warnings: Warning[]
  findings: string[]
}

const MONTH_DAYS = 30.4375
type Value = number | string
type Item = { row: ImplantRow; factor: Value | null; outcome: Value; days?: number }

function need(key: string): Variable {
  const v = variable(key)
  if (!v) throw new Error(`Unknown variable: ${key}`)
  return v
}

function labelOf(v: Variable, value: string, labels: LevelLabels): string {
  return labels[v.key]?.[value] ?? levelLabel(v, value)
}

// Groups in display order: fixed levels in their order, data-driven ones by label; "Not assessed" last.
function groupBy<T>(items: T[], key: (t: T) => string | null, v: Variable | null, labels: LevelLabels): { level: string | null; label: string; items: T[] }[] {
  const map = new Map<string | null, T[]>()
  for (const t of items) map.set(key(t), [...(map.get(key(t)) ?? []), t])
  const order = v?.levels?.map((l) => l.value)
  const levels = [...map.keys()].filter((k): k is string => k !== null)
  levels.sort((a, b) => order && !sortsByLabel(v!)
    ? (order.indexOf(a) + 1 || 1e9) - (order.indexOf(b) + 1 || 1e9) || a.localeCompare(b)
    : (v ? labelOf(v, a, labels) : a).localeCompare(v ? labelOf(v, b, labels) : b))
  const out: { level: string | null; label: string; items: T[] }[] =
    levels.map((level) => ({ level, label: v ? labelOf(v, level, labels) : level, items: map.get(level)! }))
  if (map.has(null)) out.push({ level: null, label: NOT_ASSESSED, items: map.get(null)! })
  return out
}

const patientsOf = (rows: ImplantRow[]) => new Set(rows.map((r) => r.patient_id)).size
const median = (xs: number[]) => describe(xs)?.median ?? null

export function runAnalysis(data: AnalysisData, config: AnalysisConfig, today: string, labels: LevelLabels = {}): AnalysisResult {
  const fv = config.factor ? need(config.factor) : null
  const ov = need(config.outcome)
  const rows = applyFilters(data.implants, config.filters)
  const sites = new Set(rows.map((r) => r.site_id))
  const scoped: AnalysisData = {
    implants: rows,
    visits: data.visits.filter((v) => sites.has(v.site_id)),
    radiographs: data.radiographs.filter((r) => sites.has(r.site_id)),
  }
  const observational = ov.source !== 'implant'
  const longitudinal = config.window === 'all' && observational
  const window: Window = config.window === 'all' ? 'm12' : config.window
  const chosen = choose(fv?.kind ?? null, ov.kind, longitudinal)
  const missing: Missing = {}
  const bump = (k: keyof Missing) => { missing[k] = (missing[k] ?? 0) + 1 }
  const factorOf = (row: ImplantRow) => (fv ? fv.get(row) : 'all')

  // Outcome per implant.
  const items: Item[] = []
  let spreadDays: number[] = []
  if (ov.kind === 'survival') {
    for (const row of rows) {
      if (row.event_time_unknown) bump('not_applicable')
      else items.push({ row, factor: factorOf(row), outcome: row.follow_up_days })
    }
  } else if (longitudinal) {
    const traj = trajectories(scoped, ov.measure!, today)
    for (const row of rows) {
      const t = traj.get(row.site_id) ?? {}
      if (Object.keys(t).length === 0) bump('missing')
      else items.push({ row, factor: factorOf(row), outcome: 0 })
    }
  } else if (observational) {
    const { values, missing: why } = observe(scoped, ov.measure!, window, today)
    for (const row of rows) {
      const o = values.get(row.site_id)
      if (o) items.push({ row, factor: factorOf(row), outcome: o.value, days: o.days })
      else bump(why.get(row.site_id)!)
    }
    spreadDays = items.map((i) => i.days!)
  } else {
    for (const row of rows) {
      const value = ov.get(row)
      if (value === null) bump('not_recorded')
      else items.push({ row, factor: factorOf(row), outcome: value })
    }
  }
  if (fv) for (const i of items) if (i.factor === null) bump('factor_not_assessed')

  let groups: GroupSummary[] = []
  let test: TestResult | null = null
  let effect: Effect | null = null
  let standardized: Effect | null = null
  let survival: SurvivalCurve[] | null = null
  let points: AnalysisResult['points'] = []
  let line: AnalysisResult['line'] = null
  let trend: TrendPoint[] | null = null
  let unsplittable: string | null = null
  const factorKey = (i: Item) => (i.factor === null ? null : String(i.factor))
  const summary = (level: string | null, label: string, its: Item[], numeric: boolean): GroupSummary => {
    const g: GroupSummary = { level, label, n: its.length, patients: patientsOf(its.map((i) => i.row)), stats: null, tested: level !== null }
    if (numeric) g.stats = describe(its.map((i) => i.outcome as number))
    else g.counts = Object.fromEntries(groupBy(its, (i) => String(i.outcome), ov, labels).map((x) => [x.level, x.items.length]))
    return g
  }
  const testable = () => groups.filter((g) => g.tested && g.n >= MIN_TESTED)

  switch (chosen.method) {
    case 'describe':
      groups = [summary('all', 'All implants', items, ov.kind === 'continuous' || ov.kind === 'count')]
      groups[0].tested = false
      break

    case 'numeric_by_group': {
      const factorNumeric = fv!.kind === 'continuous' || fv!.kind === 'count'
      if (factorNumeric) {
        // Groups are the outcome levels; the values compared are the factor.
        const usable = items.filter((i) => i.factor !== null).map((i) => ({ ...i, outcome: i.factor as number, factor: i.outcome }))
        groups = groupBy(usable, factorKey, ov, labels).map((g) => summary(g.level, `${ov.label}: ${g.label}`, g.items, true))
      } else {
        groups = groupBy(items, factorKey, fv, labels).map((g) => summary(g.level, g.label, g.items, true))
      }
      const valuesOf = (g: GroupSummary) =>
        (factorNumeric ? items.filter((i) => String(i.outcome) === g.level).map((i) => i.factor as number)
          : items.filter((i) => factorKey(i) === g.level).map((i) => i.outcome as number)).filter((x) => Number.isFinite(x))
      const t = testable()
      if (t.length === 2) {
        const [a, b] = t.map(valuesOf)
        const mw = mannWhitney(a, b)
        if (mw) test = { name: 'Mann–Whitney U', statistic: `W = ${fmt(mw.w)}`, p: mw.p }
        const w = welch(a, b)
        if (w) effect = { name: `Mean difference (${t[1].label} − ${t[0].label})`, value: w.diff, lo: w.lo, hi: w.hi }
        const g = hedgesG(a, b)
        if (g !== null) standardized = { name: 'Hedges g', value: g }
      } else if (t.length > 2) {
        const k = kruskalWallis(t.map(valuesOf))
        if (k) test = { name: 'Kruskal–Wallis', statistic: `H = ${fmt(k.h)}, df = ${k.df}`, p: k.p }
      }
      break
    }

    case 'categorical_by_group': {
      groups = groupBy(items, factorKey, fv, labels).map((g) => summary(g.level, g.label, g.items, false))
      const t = testable()
      const outcomeLevels = [...new Set(t.flatMap((g) => Object.keys(g.counts!)))]
      if (t.length >= 2 && outcomeLevels.length >= 2) {
        const table = t.map((g) => outcomeLevels.map((l) => g.counts![l] ?? 0))
        const chi = chiSquare(table)
        if (table.length === 2 && outcomeLevels.length === 2 && (!chi || chi.minExpected < 5)) {
          test = { name: "Fisher's exact", statistic: '2 × 2 table', p: fisher2x2(table as [[number, number], [number, number]]).p }
        } else if (chi) {
          test = { name: 'Chi-square', statistic: `χ² = ${fmt(chi.chisq)}, df = ${chi.df}`, p: chi.p }
        }
        if (t.length === 2 && outcomeLevels.length === 2) {
          const positive = outcomeLevels.includes('yes') ? 'yes' : outcomeLevels[0]
          const rd = riskDifference(t[0].counts![positive] ?? 0, t[0].n, t[1].counts![positive] ?? 0, t[1].n)
          if (rd) effect = { name: `Risk difference (${t[1].label} − ${t[0].label})`, value: rd.diff, lo: rd.lo, hi: rd.hi }
        }
      }
      break
    }

    case 'correlation': {
      const pairs = items.filter((i) => typeof i.factor === 'number' && typeof i.outcome === 'number')
      const x = pairs.map((i) => i.factor as number)
      const y = pairs.map((i) => i.outcome as number)
      points = pairs.map((i) => ({ siteId: i.row.site_id, x: i.factor!, y: i.outcome }))
      line = ols(x, y)
      const s = spearman(x, y)
      if (s) {
        standardized = { name: 'Spearman ρ', value: s.rho }
        if (s.p !== null) test = { name: 'Spearman', statistic: `ρ = ${fmt(s.rho)}`, p: s.p }
      }
      const p = pearson(x, y)
      if (p) effect = { name: 'Pearson r', value: p.r, ...(p.lo !== null ? { lo: p.lo, hi: p.hi! } : {}) }
      break
    }

    case 'survival': {
      let grouped: { level: string | null; label: string; items: Item[] }[]
      if (!fv) grouped = [{ level: 'all', label: 'All implants', items }]
      else if (fv.kind === 'continuous' || fv.kind === 'count') {
        const usable = items.filter((i) => typeof i.factor === 'number')
        const m = median(usable.map((i) => i.factor as number))
        const low = usable.filter((i) => (i.factor as number) <= m!)
        const high = usable.filter((i) => (i.factor as number) > m!)
        const unit = fv.unit ? ` ${fv.unit}` : ''
        if (m === null || low.length === 0 || high.length === 0) { unsplittable = fv.label; grouped = [] }
        else grouped = [
          { level: 'low', label: `${fv.label} ≤ ${fmt(m)}${unit}`, items: low },
          { level: 'high', label: `${fv.label} > ${fmt(m)}${unit}`, items: high },
        ]
        const nulls = items.filter((i) => i.factor === null)
        if (nulls.length) grouped.push({ level: null, label: NOT_ASSESSED, items: nulls })
      } else grouped = groupBy(items, factorKey, fv, labels)
      groups = grouped.map((g) => ({ level: g.level, label: g.label, n: g.items.length, patients: patientsOf(g.items.map((i) => i.row)), stats: null, tested: g.level !== null && !!fv }))
      if (!fv) groups[0].tested = false
      const rowsOf = (its: Item[]): SurvivalRow[] => its.map((i) => ({ months: (i.outcome as number) / MONTH_DAYS, event: i.row.event }))
      const curves = grouped.filter((g) => g.level !== null || !fv)
      if (!unsplittable && curves.length) {
        survival = curves.map((g) => {
          const fit = kmFit(rowsOf(g.items))
          const at = (months: number) => (fit.times.length ? survivalAtTime(fit, months).surv : null)
          return { label: g.label, fit, at12: at(12), at24: at(24) }
        })
        const t = grouped.filter((g) => g.level !== null && g.items.length >= MIN_TESTED)
        if (fv && t.length >= 2) {
          const lr = logRank(t.map((g) => rowsOf(g.items)))
          if (lr.p !== null) test = { name: 'Log-rank', statistic: `χ² = ${fmt(lr.chisq)}, df = ${lr.df}`, p: lr.p }
        }
      }
      break
    }

    case 'trend': {
      const traj = trajectories(scoped, ov.measure!, today)
      trend = []
      for (const g of groupBy(items, factorKey, fv, labels)) {
        for (const { key } of TIMEPOINTS) {
          const values = g.items.map((i) => traj.get(i.row.site_id)?.[key as TimepointKey]?.value).filter((x): x is number => typeof x === 'number')
          const d = describe(values)
          if (d) trend.push({ label: fv ? g.label : 'All implants', window: key, n: d.n, median: d.median, q1: d.q1, q3: d.q3 })
        }
      }
      groups = groupBy(items, factorKey, fv, labels).map((g) => ({
        level: g.level, label: fv ? g.label : 'All implants', n: g.items.length, patients: patientsOf(g.items.map((i) => i.row)), stats: null, tested: false,
      }))
      break
    }
  }

  const range = windowRange(window)
  const notEligible = (missing.pending ?? 0) + (missing.not_applicable ?? 0)
  const base = {
    method: chosen.method, views: chosen.views, explain: chosen.explain, implants: rows.length, patients: patientsOf(rows),
    included: items.length, missing, groups, test, effect, standardized, survival, points, line, trend,
  }
  const warnings = warningsFor(base, {
    outcomeLabel: ov.label,
    observational: observational && !longitudinal,
    eligible: rows.length - notEligible,
    missingCount: (missing.missing ?? 0) + (missing.not_measured ?? 0) + (missing.not_recorded ?? 0) + (missing.not_attended ?? 0),
    spreadDays,
    windowWidth: range.to === null || range.to === range.from ? null : range.to - range.from,
    conflicts: conflictCount(scoped),
    factorKey: fv?.key ?? null,
    needsTest: fv !== null && chosen.method !== 'trend' && !unsplittable,
    unsplittable,
  })
  const findings = findingsFor({ ...base }, { factor: fv?.label ?? null, outcome: ov.label, unit: ov.unit })
  return { ...base, warnings, findings }
}

// Plain-language findings for an Explore analysis. Observational data: describe what the dataset shows, never a
// cause; no "best/worst"; counts always with their denominator.

import type { Effect, GroupSummary, Method, SurvivalCurve, TestResult, TrendPoint } from './types'

export const CAUSATION = 'Association does not necessarily imply causation.'

export type FindingsInput = {
  method: Method
  groups: GroupSummary[]
  test: TestResult | null
  standardized: Effect | null
  survival: SurvivalCurve[] | null
  trend: TrendPoint[] | null
  included: number
}
export type FindingsLabels = { factor: string | null; outcome: string; unit?: string }

/** At most two decimals, a real minus sign. */
export function fmt(n: number): string {
  return String(Number(n.toFixed(2))).replace('-', '−')
}
const pct = (s: number | null) => (s === null ? '—' : `${Math.round(s * 100)}%`)

function numericGroups(groups: GroupSummary[], l: FindingsLabels): string[] {
  const unit = l.unit ? ` ${l.unit}` : ''
  const withStats = groups.filter((g) => g.stats)
  const tested = withStats.filter((g) => g.tested)
  if (tested.length === 2) {
    const [a, b] = tested
    const ma = a.stats!.median
    const mb = b.stats!.median
    if (Math.abs(ma - mb) < 1e-9) {
      return [`${l.outcome} was similar in the ${a.label} and ${b.label} groups in this dataset (median ${fmt(ma)} vs ${fmt(mb)}${unit}).`]
    }
    const [hi, lo] = mb > ma ? [b, a] : [a, b]
    return [`${l.outcome} was higher in the ${hi.label} group in this dataset (median ${fmt(hi.stats!.median)} vs ${fmt(lo.stats!.median)}${unit}).`]
  }
  if (withStats.length === 0) return []
  return [`Median ${l.outcome} by ${l.factor ?? 'group'}: ${withStats.map((g) => `${g.label} ${fmt(g.stats!.median)}${unit} (n = ${g.n})`).join(', ')}.`]
}

function countGroups(groups: GroupSummary[], l: FindingsLabels): string[] {
  const shown = groups.filter((g) => g.counts && g.tested).length ? groups.filter((g) => g.counts && g.tested) : groups.filter((g) => g.counts)
  if (shown.length === 0) return []
  const binary = shown.every((g) => Object.keys(g.counts!).every((k) => k === 'yes' || k === 'no'))
  if (binary) return [`${l.outcome}: ${shown.map((g) => `${g.counts!.yes ?? 0} of ${g.n} implants (${g.label})`).join(' vs ')}.`]
  return shown.map((g) => `${l.outcome} (${g.label}): ${Object.entries(g.counts!).map(([k, n]) => `${k} ${n} of ${g.n}`).join(', ')}.`)
}

export function findingsFor(r: FindingsInput, l: FindingsLabels): string[] {
  const out: string[] = []
  switch (r.method) {
    case 'numeric_by_group':
      out.push(...numericGroups(r.groups, l))
      break
    case 'categorical_by_group':
      out.push(...countGroups(r.groups, l))
      break
    case 'correlation': {
      const rho = r.standardized?.value
      if (rho === undefined) out.push(`Not enough paired values to describe ${l.factor} and ${l.outcome} together.`)
      else if (r.test && r.test.p < 0.05) out.push(`An association was observed between ${l.factor} and ${l.outcome} (Spearman ρ ${fmt(rho)}).`)
      else out.push(`No clear association was observed between ${l.factor} and ${l.outcome} (Spearman ρ ${fmt(rho)}).`)
      break
    }
    case 'survival':
      if (r.survival?.length) out.push(`Estimated survival at 12 months: ${r.survival.map((s) => `${pct(s.at12)} (${s.label})`).join(' vs ')}.`)
      break
    case 'trend':
      out.push(`${l.outcome} across follow-up windows, from ${r.included} implants with at least one value.`)
      break
    case 'describe': {
      const g = r.groups[0]
      if (g?.stats) out.push(`Median ${l.outcome} ${fmt(g.stats.median)}${l.unit ? ` ${l.unit}` : ''} across ${g.n} implants.`)
      else if (g?.counts) out.push(...countGroups(r.groups, l))
      break
    }
  }
  if (l.factor !== null && r.method !== 'describe') out.push(CAUSATION)
  return out
}

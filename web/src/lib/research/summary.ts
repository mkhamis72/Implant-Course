// Aggregates what SQL decided (implant_outcomes_detail / crown_outcomes_detail). Never recomputes a status.
import { kmFit, survivalAtTime } from './stats'

export type Milestone = 'survived' | 'failed' | 'unknown' | 'not_reached' | 'not_loaded'

export type ImplantRow = {
  year_1: Milestone | string
  year_2: Milestone | string
  latest_grade: 'I' | 'II' | 'III' | 'IV' | 'not_assessable' | null
  biological_complications: number
  mechanical_complications: number
  follow_up_days: number
  event: boolean
  event_time_unknown: boolean
}

export type CrownRow = {
  remade: boolean
  problems: number
}

const MONTH_DAYS = 30.4375
const SMALL_SAMPLE = 30

export function survivalAt(rows: ImplantRow[], key: 'year_1' | 'year_2') {
  let survived = 0
  let failed = 0
  let notReached = 0
  let unknown = 0
  for (const r of rows) {
    const v = r[key]
    if (v === 'survived') survived++
    else if (v === 'failed') failed++
    else if (v === 'not_reached') notReached++
    else if (v === 'unknown') unknown++
  }
  const m = survived + failed
  return {
    survived,
    failed,
    notReached,
    unknown,
    pct: m === 0 ? null : (survived / m) * 100,
    small: m < SMALL_SAMPLE,
  }
}

export function icoiBreakdown(rows: ImplantRow[]) {
  const out = { I: 0, II: 0, III: 0, IV: 0, not_assessable: 0, not_graded: 0 }
  for (const r of rows) {
    const g = r.latest_grade
    if (g === 'I' || g === 'II' || g === 'III' || g === 'IV' || g === 'not_assessable') out[g]++
    else out.not_graded++
  }
  return out
}

export function complications(rows: ImplantRow[]) {
  const implants = rows.length
  const biological = rows.filter((r) => r.biological_complications > 0).length
  const mechanical = rows.filter((r) => r.mechanical_complications > 0).length
  return {
    implants,
    biological,
    mechanical,
    biologicalPct: implants === 0 ? null : (biological / implants) * 100,
    mechanicalPct: implants === 0 ? null : (mechanical / implants) * 100,
  }
}

export function crownSummary(crowns: CrownRow[]) {
  return {
    finals: crowns.length,
    remade: crowns.filter((c) => c.remade).length,
    problems: crowns.filter((c) => c.problems > 0).length,
  }
}

// Product-limit estimate; at tied times events are applied before censorings.
export function kaplanMeier(rows: ImplantRow[]) {
  const known = rows.filter((r) => !r.event_time_unknown)
  const fit = kmFit(known.map((r) => ({ months: r.follow_up_days / MONTH_DAYS, event: r.event })))
  const points = [{ month: 0, survival: 1 }]
  // The 95% CI from each event onwards (it only changes at events); null where it can't be estimated.
  const band: { month: number; lower: number | null; upper: number | null }[] = []
  fit.times.forEach((month, i) => {
    if (fit.nEvent[i] > 0) {
      points.push({ month, survival: fit.surv[i] })
      band.push({ month, lower: fit.lower[i], upper: fit.upper[i] })
    }
  })
  return {
    points,
    band,
    atRisk: ([[0, 0], [12, MILESTONE_DAYS.year_1], [24, MILESTONE_DAYS.year_2]] as const).map(([month, days]) => ({
      month,
      n: survivalAtTime(fit, days / MONTH_DAYS).nRisk,
    })),
    excludedUnknownTime: rows.length - known.length,
  }
}

// The tiles' milestones: day 365 and day 730 (the curve labels them 12 and 24 months).
export const MILESTONE_DAYS = { year_1: 365, year_2: 730 } as const

// The KM estimate at day `days` (365 = the 1-year tile), from the same fit as the curve. `defined` is false past the
// last follow-up (nobody left at risk and the curve hasn't reached 0); `events` are the failures up to that time;
// `n` is the implants in the fit (known failure date).
export function kmEstimate(rows: ImplantRow[], days: number) {
  const months = days / MONTH_DAYS
  const known = rows.filter((r) => !r.event_time_unknown)
  const fit = kmFit(known.map((r) => ({ months: r.follow_up_days / MONTH_DAYS, event: r.event })))
  const at = survivalAtTime(fit, months)
  let events = 0
  fit.times.forEach((t, i) => {
    if (t <= months) events += fit.nEvent[i]
  })
  return { ...at, events, n: known.length, defined: known.length > 0 && (at.nRisk > 0 || at.surv === 0) }
}

export function formatPct(pct: number | null): string {
  return pct === null ? '—' : `${pct.toFixed(1)}%`
}

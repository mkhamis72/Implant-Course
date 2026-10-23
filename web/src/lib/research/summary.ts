// Aggregates what SQL decided (implant_outcomes_detail / crown_outcomes_detail). Never recomputes a status.

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
  const times = known.map((r) => ({ month: r.follow_up_days / MONTH_DAYS, event: r.event }))
  const points = [{ month: 0, survival: 1 }]
  const eventMonths = [...new Set(times.filter((t) => t.event).map((t) => t.month))].sort((a, b) => a - b)
  let s = 1
  for (const m of eventMonths) {
    const atRisk = times.filter((t) => t.month >= m).length
    const d = times.filter((t) => t.event && t.month === m).length
    s *= 1 - d / atRisk
    points.push({ month: m, survival: s })
  }
  const n = (m: number) => times.filter((t) => t.month >= m).length
  return {
    points,
    atRisk: ([0, 12, 24] as const).map((month) => ({ month, n: n(month) })),
    excludedUnknownTime: rows.length - known.length,
  }
}

export function formatPct(pct: number | null): string {
  return pct === null ? '—' : `${pct.toFixed(1)}%`
}

// Data-quality warnings for an Explore analysis. They inform; they never hide a number (owner rule).

import { CLUSTER_NOTE, OPERATOR_NOTE } from '@/lib/research/groups'
import { THIN_GROUP } from '@/lib/research/stats'
import type { AnalysisData } from './rows'
import { describe } from './tests'
import type { GroupSummary, Method, TestResult } from './types'

export type Warning = {
  kind: 'small_group' | 'missing' | 'unequal' | 'spread' | 'insufficient' | 'conflicting' | 'cluster' | 'operator'
  text: string
  group?: string
}

export type QualityInput = { method: Method; groups: GroupSummary[]; test: TestResult | null; implants: number; patients: number }
export type QualityContext = {
  outcomeLabel: string
  /** A visit or X-ray measure read at a timepoint (the missing-data warning applies). */
  observational: boolean
  /** Implants that could have a value (not pending, not applicable). */
  eligible: number
  missingCount: number
  /** Days since placement of the values used, for the spread check. */
  spreadDays: number[]
  windowWidth: number | null
  conflicts: number
  factorKey: string | null
  needsTest: boolean
  /** Label of a continuous factor that has too few distinct values to split at its median. */
  unsplittable: string | null
}

export const MIN_TESTED = 3

export function warningsFor(r: QualityInput, c: QualityContext): Warning[] {
  const w: Warning[] = []
  const tested = r.groups.filter((g) => g.tested)
  for (const g of tested) {
    if (g.n < THIN_GROUP) {
      w.push({ kind: 'small_group', group: g.label, text: `⚠ This group contains only ${g.n} implants. Results should be interpreted cautiously.` })
    }
  }
  if (c.observational && c.eligible > 0) {
    const pct = Math.round((c.missingCount / c.eligible) * 100)
    if (pct > 20) w.push({ kind: 'missing', text: `⚠ ${pct}% of eligible implants have no ${c.outcomeLabel} at this timepoint.` })
  }
  const sizes = tested.map((g) => g.n).filter((n) => n > 0)
  if (sizes.length >= 2 && Math.max(...sizes) / Math.min(...sizes) > 4) {
    w.push({ kind: 'unequal', text: '⚠ Group sizes are substantially different.' })
  }
  const spread = describe(c.spreadDays)
  if (spread && c.windowWidth && spread.q3 - spread.q1 > c.windowWidth / 2) {
    w.push({ kind: 'spread', text: '⚠ Follow-up timing varies considerably between observations.' })
  }
  if (c.unsplittable) {
    w.push({ kind: 'insufficient', text: `${c.unsplittable} has too few distinct values to split into groups.` })
  } else if (c.needsTest && r.test === null && tested.filter((g) => g.n >= MIN_TESTED).length < 2) {
    w.push({ kind: 'insufficient', text: 'Not enough valid observations to generate a reliable comparison.' })
  }
  if (c.conflicts > 0) w.push({ kind: 'conflicting', text: 'Some records contain inconsistent dates or clinical values.' })
  if (r.test && r.implants > r.patients) w.push({ kind: 'cluster', text: CLUSTER_NOTE })
  if (c.factorKey === 'delegate' || c.factorKey === 'supervisor' || c.factorKey === 'course') {
    w.push({ kind: 'operator', text: OPERATOR_NOTE })
  }
  return w
}

/**
 * Records dated before their implant was placed: visits, the event and the final restoration. X-rays are not
 * counted: pre-operative X-rays of the tooth (and those of an earlier implant there) are legitimately older.
 */
export function conflictCount(data: AnalysisData): number {
  const sites = new Set(data.implants.map((i) => i.site_id))
  return data.implants.filter((i) => (i.event_on !== null && i.event_on < i.placed_on)
      || (i.final_restoration_on !== null && i.final_restoration_on < i.placed_on)).length
    + data.visits.filter((v) => sites.has(v.site_id) && v.days_since_placement < 0).length
}

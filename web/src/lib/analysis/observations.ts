// One value per implant per follow-up window, or the reason there is none. Visit measures come from attended
// visits, bone measures from X-rays of the implant; ISQ at placement comes from the implant itself.

import type { AnalysisData, ImplantRow, Measure, RadiographRow, VisitRow } from './rows'
import { daysBetween, TIMEPOINTS, type TimepointKey, type Window, windowRange } from './timepoints'

export type MissingReason = 'not_applicable' | 'pending' | 'not_attended' | 'not_measured' | 'not_recorded' | 'missing'

export const MISSING_LABELS: Record<MissingReason, string> = {
  not_applicable: 'Not applicable',
  pending: 'Pending (not due yet)',
  not_attended: 'Did not attend',
  not_measured: 'X-ray without measurement',
  not_recorded: 'Not recorded at the visit',
  missing: 'No record in this window',
}

export type Observation = { siteId: string; value: number | string; on: string; days: number }

const BONE: Partial<Record<Measure, (r: RadiographRow) => number | null>> = {
  bone_change: (r) => r.bone_change_mm,
  bone_mesial: (r) => r.mesial_mm,
  bone_distal: (r) => r.distal_mm,
}

function visitValue(measure: Measure, v: VisitRow, implant: ImplantRow): number | string | null {
  switch (measure) {
    case 'isq': return v.isq
    case 'isq_change': return v.isq === null || implant.isq === null ? null : v.isq - implant.isq
    case 'probing_max': return v.probing_max
    case 'bop': return v.bop_any
    case 'suppuration': return v.suppuration
    case 'mobility': return v.mobility
    case 'plaque': return v.plaque
    case 'pain': return v.pain_score
    case 'recession_facial': return v.recession_facial_mm
    case 'recession_mesial': return v.recession_mesial_mm
    case 'recession_distal': return v.recession_distal_mm
    case 'recession_max': {
      const sites = [v.recession_facial_mm, v.recession_mesial_mm, v.recession_distal_mm].filter((x): x is number => x !== null)
      return sites.length ? Math.max(...sites) : null
    }
    default: return null
  }
}

type Indexed = { visits: Map<string, VisitRow[]>; radiographs: Map<string, RadiographRow[]> }
function index(data: AnalysisData): Indexed {
  const group = <T extends { site_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>()
    for (const r of rows) m.set(r.site_id, [...(m.get(r.site_id) ?? []), r])
    return m
  }
  return { visits: group(data.visits), radiographs: group(data.radiographs) }
}

// The candidate closest to the target; ties and a null target (latest) go to the later observation.
function closest(obs: Observation[], target: number | null): Observation | undefined {
  return [...obs].sort((a, b) => (target === null ? 0 : Math.abs(a.days - target) - Math.abs(b.days - target)) || b.days - a.days)[0]
}

function observeOne(
  implant: ImplantRow, idx: Indexed, measure: Measure, window: Window, today: string,
): Observation | MissingReason {
  const { from, to, target } = windowRange(window)
  const inside = (days: number) => days >= from && (to === null || days <= to)
  const site = implant.site_id
  const radiograph = BONE[measure]
  const candidates: Observation[] = []
  let notMeasured = false
  let notApplicable = false
  let notRecorded = false
  let notAttended = false

  if (radiograph) {
    for (const r of (idx.radiographs.get(site) ?? []).filter((x) => inside(x.days_since_placement))) {
      const value = radiograph(r)
      if (value !== null) candidates.push({ siteId: site, value, on: r.taken_on, days: r.days_since_placement })
      else if (r.mesial_mm === null && r.distal_mm === null) notMeasured = true
      else notApplicable = true // measured, but no baseline to compare with (or this is the baseline)
    }
  } else {
    if (measure === 'isq' && inside(0) && implant.isq !== null) {
      candidates.push({ siteId: site, value: implant.isq, on: implant.placed_on, days: 0 })
    }
    if (measure === 'isq_change' && implant.isq === null) notApplicable = true
    for (const v of (idx.visits.get(site) ?? []).filter((x) => inside(x.days_since_placement))) {
      if (v.attendance !== 'attended') { notAttended = true; continue }
      const value = visitValue(measure, v, implant)
      if (value !== null) candidates.push({ siteId: site, value, on: v.date, days: v.days_since_placement })
      else notRecorded = true
    }
  }

  const best = closest(candidates, target)
  if (best) return best
  const failedOn = implant.event_on ? daysBetween(implant.placed_on, implant.event_on) : null
  if (notApplicable || (failedOn !== null && failedOn < from)) return 'not_applicable'
  if (notMeasured) return 'not_measured'
  if (notRecorded) return 'not_recorded'
  if (notAttended) return 'not_attended'
  const now = daysBetween(implant.placed_on, today)
  if (now < from || (to !== null && now <= to)) return 'pending'
  return 'missing'
}

export function observe(
  data: AnalysisData, measure: Measure, window: Window, today: string,
): { values: Map<string, Observation>; missing: Map<string, MissingReason> } {
  const idx = index(data)
  const values = new Map<string, Observation>()
  const missing = new Map<string, MissingReason>()
  for (const implant of data.implants) {
    const r = observeOne(implant, idx, measure, window, today)
    if (typeof r === 'string') missing.set(implant.site_id, r)
    else values.set(implant.site_id, r)
  }
  return { values, missing }
}

export function trajectories(
  data: AnalysisData, measure: Measure, today: string,
): Map<string, Partial<Record<TimepointKey, Observation>>> {
  const idx = index(data)
  const out = new Map<string, Partial<Record<TimepointKey, Observation>>>()
  for (const implant of data.implants) {
    const t: Partial<Record<TimepointKey, Observation>> = {}
    for (const { key } of TIMEPOINTS) {
      const r = observeOne(implant, idx, measure, key, today)
      if (typeof r !== 'string') t[key] = r
    }
    out.set(implant.site_id, t)
  }
  return out
}

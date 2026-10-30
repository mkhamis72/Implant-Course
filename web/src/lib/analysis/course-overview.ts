// Per-course aggregates for Statistics → Courses, over the Explore readers' rows (0078). Descriptive counts only:
// courses keep the order they are given in (start date), and every share is "k of n", "—" when n is 0.

import { NONE } from './filters'
import type { AnalysisData, ImplantRow } from './rows'
import { daysBetween, TIMEPOINTS, windowFor, type TimepointKey } from './timepoints'

export type CourseOption = { id: string; name: string; start_date: string | null }
export type Share = { label: string; count: number }
export type MeasurementKey = 'torque' | 'isq_placement' | 'bone_type' | 'bone_level' | 'probing' | 'recession'
export type FollowUpWindow = { key: TimepointKey; label: string; attended: number; due: number; pending: number }
export type CourseSummary = {
  id: string; name: string; startDate: string | null; implants: number; patients: number; thin: boolean
  systems: Share[]; dimensions: Share[]; followUp: FollowUpWindow[]
  prosthetic: { done: number; eligible: number }
  complications: { biological: number; mechanical: number; implantsWithRestorationProblem: number; implantsAffected: number }
  measurements: { key: MeasurementKey; label: string; recorded: number }[]
}
export type MetricRow = { group: string; label: string; values: string[] }

/** The Results page's "small sample" rule. */
const THIN_BELOW = 30
const NOT_RECORDED = 'Not recorded'
const COMPLICATIONS = 'Complications (surgical not included)'
const FOLLOW_UP_WINDOWS: TimepointKey[] = ['early', 'm3', 'm6', 'm12', 'm24']
const MEASUREMENT_LABELS: Record<MeasurementKey, string> = {
  torque: 'Insertion torque',
  isq_placement: 'ISQ at placement',
  bone_type: 'Bone type',
  bone_level: 'X-ray bone level',
  probing: 'Probing',
  recession: 'Recession',
}

const byLabel = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

function shares(labels: string[]): Share[] {
  const counts = new Map<string, number>()
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1)
  return [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => byLabel(a.label, b.label))
}

const systemLabel = (r: ImplantRow) => [r.brand, r.system].filter(Boolean).join(' ') || NOT_RECORDED
const dimensionLabel = (r: ImplantRow) =>
  r.diameter_mm === null || r.length_mm === null ? NOT_RECORDED : `Ø${r.diameter_mm.toFixed(1)} × ${r.length_mm} mm`

type Seen = { attended: Map<string, Set<TimepointKey>>; measured: Record<'bone_level' | 'probing' | 'recession', Set<string>> }

function seenIn(data: AnalysisData): Seen {
  const seen: Seen = { attended: new Map(), measured: { bone_level: new Set(), probing: new Set(), recession: new Set() } }
  for (const v of data.visits) {
    if (v.attendance !== 'attended') continue
    const windows = seen.attended.get(v.site_id) ?? new Set<TimepointKey>()
    seen.attended.set(v.site_id, windows.add(windowFor(v.days_since_placement)))
    if (v.probing_max !== null) seen.measured.probing.add(v.site_id)
    if (v.recession_facial_mm !== null || v.recession_mesial_mm !== null || v.recession_distal_mm !== null) seen.measured.recession.add(v.site_id)
  }
  for (const r of data.radiographs) {
    if (r.mesial_mm !== null || r.distal_mm !== null) seen.measured.bone_level.add(r.site_id)
  }
  return seen
}

function followUp(rows: ImplantRow[], seen: Seen, today: string): FollowUpWindow[] {
  return FOLLOW_UP_WINDOWS.map((key) => {
    const t = TIMEPOINTS.find((p) => p.key === key)!
    const w: FollowUpWindow = { key, label: t.label, attended: 0, due: 0, pending: 0 }
    for (const r of rows) {
      if (r.event_on && daysBetween(r.placed_on, r.event_on) < t.from) continue // failed before this window
      if (seen.attended.get(r.site_id)?.has(key)) { w.attended++; w.due++ }
      else if (t.to !== null && daysBetween(r.placed_on, today) > t.to) w.due++
      else w.pending++
    }
    return w
  })
}

function summarise(id: string, name: string, startDate: string | null, rows: ImplantRow[], seen: Seen, today: string): CourseSummary {
  const has = (test: (r: ImplantRow) => boolean) => rows.filter(test).length
  const recorded: Record<MeasurementKey, number> = {
    torque: has((r) => r.torque_ncm !== null),
    isq_placement: has((r) => r.isq !== null),
    bone_type: has((r) => r.bone_type !== null),
    bone_level: has((r) => seen.measured.bone_level.has(r.site_id)),
    probing: has((r) => seen.measured.probing.has(r.site_id)),
    recession: has((r) => seen.measured.recession.has(r.site_id)),
  }
  const sum = (get: (r: ImplantRow) => number) => rows.reduce((total, r) => total + get(r), 0)
  return {
    id, name, startDate,
    implants: rows.length,
    patients: new Set(rows.map((r) => r.patient_id)).size,
    thin: rows.length > 0 && rows.length < THIN_BELOW,
    systems: shares(rows.map(systemLabel)),
    dimensions: shares(rows.map(dimensionLabel)),
    followUp: followUp(rows, seen, today),
    prosthetic: {
      done: has((r) => r.final_restoration_on !== null),
      eligible: has((r) => !r.event || r.final_restoration_on !== null),
    },
    complications: {
      biological: sum((r) => r.biological_complications),
      mechanical: sum((r) => r.mechanical_complications),
      // Implants, not problems: the reader counts a problem once per implant of its restoration, so a sum would inflate bridges.
      implantsWithRestorationProblem: has((r) => r.restoration_problems > 0),
      implantsAffected: has((r) => r.biological_complications + r.mechanical_complications + r.restoration_problems > 0),
    },
    measurements: (Object.keys(MEASUREMENT_LABELS) as MeasurementKey[]).map((key) => ({ key, label: MEASUREMENT_LABELS[key], recorded: recorded[key] })),
  }
}

export function courseOverview(data: AnalysisData, courses: CourseOption[], today: string): CourseSummary[] {
  const seen = seenIn(data)
  const rowsOf = new Map<string, ImplantRow[]>()
  for (const r of data.implants) {
    const key = r.course_id ?? NONE
    rowsOf.set(key, [...(rowsOf.get(key) ?? []), r])
  }
  const summaries = courses.map((c) => summarise(c.id, c.name, c.start_date, rowsOf.get(c.id) ?? [], seen, today))
  const noCourse = rowsOf.get(NONE)
  return noCourse ? [...summaries, summarise(NONE, 'No course recorded', null, noCourse, seen, today)] : summaries
}

const ratio = (k: number, n: number) => (n === 0 ? '—' : `${k} of ${n}`)

function shareRows(group: string, summaries: CourseSummary[], get: (s: CourseSummary) => Share[]): MetricRow[] {
  const labels = [...new Set(summaries.flatMap((s) => get(s).map((x) => x.label)))].sort(byLabel)
  return labels.map((label) => ({
    group, label,
    values: summaries.map((s) => ratio(get(s).find((x) => x.label === label)?.count ?? 0, s.implants)),
  }))
}

/** One row per metric, one value per course, in the order given. */
export function metricRows(summaries: CourseSummary[]): MetricRow[] {
  const row = (group: string, label: string, value: (s: CourseSummary) => string): MetricRow => ({ group, label, values: summaries.map(value) })
  const first = summaries[0]
  if (!first) return []
  return [
    row('Course', 'Implants', (s) => String(s.implants)),
    row('Course', 'Patients', (s) => String(s.patients)),
    ...shareRows('Systems', summaries, (s) => s.systems),
    ...shareRows('Dimensions', summaries, (s) => s.dimensions),
    ...first.followUp.map(({ key, label }) => row('Follow-up visits attended', label, (s) => {
      const w = s.followUp.find((x) => x.key === key)!
      return w.pending > 0 ? `${ratio(w.attended, w.due)} · ${w.pending} pending` : ratio(w.attended, w.due)
    })),
    row('Prosthetic', 'Final restoration', (s) => ratio(s.prosthetic.done, s.prosthetic.eligible)),
    // The Explore reader has no surgical count (0078), so the rows say so rather than read as every complication.
    row(COMPLICATIONS, 'Biological', (s) => String(s.complications.biological)),
    row(COMPLICATIONS, 'Mechanical', (s) => String(s.complications.mechanical)),
    row(COMPLICATIONS, 'Implants with a restoration problem', (s) => ratio(s.complications.implantsWithRestorationProblem, s.implants)),
    row(COMPLICATIONS, 'Implants with any of these', (s) => ratio(s.complications.implantsAffected, s.implants)),
    ...first.measurements.map(({ key, label }) => row('Measurements recorded', label, (s) => ratio(s.measurements.find((m) => m.key === key)!.recorded, s.implants))),
  ]
}

/** The ticked courses (`c=` in the address), in list order; unknown ids and repeats are dropped. */
export function selectedCourses(raw: string | string[] | undefined, summaries: CourseSummary[]): CourseSummary[] {
  const ids = new Set(raw === undefined ? [] : [raw].flat())
  return summaries.filter((s) => ids.has(s.id))
}

export function courseExploreHref(ids: string[]): string {
  // No course recorded has no id the readers' course filter could take: it goes through Explore's own course filter.
  if (ids.length === 1 && ids[0] !== NONE) return `/statistics/explore?course=${encodeURIComponent(ids[0])}`
  const q = new URLSearchParams({ course: 'all', f: 'course', w: 'all', x_course: ids.join(',') })
  return `/statistics/explore?${q.toString()}`
}

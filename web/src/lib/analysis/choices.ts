// Levels of a categorical variable as Explore shows them: fixed levels in their order, data-driven ones (brands,
// people, courses) by label, "Not assessed" last. Shared by runAnalysis and the filter panel.

import { describeFilters, levelLabel, NONE, NOT_ASSESSED, type Filter } from './filters'
import type { ImplantRow } from './rows'
import { sortsByLabel, variable, type Level, type Variable } from './variables'

/** Labels for data-driven levels (delegates, courses, …), by variable key then value. */
export type LevelLabels = Record<string, Record<string, string>>

export const UNKNOWN_NAME = 'Unknown (deleted)'
const PEOPLE = new Set(['delegate', 'supervisor', 'course'])
export function labelOf(v: Variable, value: string, labels: LevelLabels): string {
  return labels[v.key]?.[value] ?? (PEOPLE.has(v.key) ? UNKNOWN_NAME : levelLabel(v, value))
}

/** The filters in words, with names (not ids) for delegates, supervisors and courses. */
export function describeLabelled(filters: Filter[], labels: LevelLabels): string[] {
  return describeFilters(filters, (v, value) => (value === NONE ? NOT_ASSESSED : labelOf(v, value, labels)))
}

// Groups in display order: fixed levels in their order, data-driven ones by label; "Not assessed" last.
export function groupBy<T>(items: T[], key: (t: T) => string | null, v: Variable | null, labels: LevelLabels): { level: string | null; label: string; items: T[] }[] {
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

export function levelChoices(rows: ImplantRow[], key: string, labels: LevelLabels): Level[] {
  const v = variable(key)
  if (!v || !['categorical', 'binary', 'ordinal'].includes(v.kind)) throw new Error(`Not a categorical variable: ${key}`)
  return groupBy(rows, (r) => { const x = v.get(r); return x === null ? null : String(x) }, v, labels)
    .map((g) => ({ value: g.level ?? NONE, label: g.label }))
}

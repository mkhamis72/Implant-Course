// Population filters for Statistics → Explore, applied to the implant rows (ANDed). The six SQL filters (course,
// dates, delegate, brand, system) are applied by the readers; everything else is here.

import type { ImplantRow } from './rows'
import { variable, type Variable } from './variables'

/** values: keep rows whose value is listed (NONE matches no answer). min/max: inclusive bounds for numbers. */
export type Filter = { key: string; values?: string[]; min?: number; max?: number }

export const NONE = '__none'
export const NOT_ASSESSED = 'Not assessed'

function filterVariable(key: string): Variable {
  const v = variable(key)
  if (!v || v.source !== 'implant' || v.kind === 'survival') throw new Error(`Unknown filter: ${key}`)
  return v
}

function keeps(v: Variable, f: Filter, row: ImplantRow): boolean {
  const value = v.get(row)
  if (f.values) return f.values.includes(value === null ? NONE : String(value))
  if (value === null || typeof value !== 'number') return f.min === undefined && f.max === undefined
  return (f.min === undefined || value >= f.min) && (f.max === undefined || value <= f.max)
}

export function applyFilters(rows: ImplantRow[], filters: Filter[]): ImplantRow[] {
  const checks = filters.map((f) => ({ f, v: filterVariable(f.key) }))
  return rows.filter((row) => checks.every(({ f, v }) => keeps(v, f, row)))
}

export function levelLabel(v: Variable, value: string): string {
  if (value === NONE) return NOT_ASSESSED
  return v.levels?.find((l) => l.value === value)?.label ?? value
}

export function describeFilters(filters: Filter[]): string[] {
  return filters.map((f) => {
    const v = filterVariable(f.key)
    if (f.values) return `${v.label}: ${f.values.map((x) => levelLabel(v, x)).join(', ')}`
    const unit = v.unit ? ` ${v.unit}` : ''
    if (f.min !== undefined && f.max !== undefined) return `${v.label} ${f.min}–${f.max}${unit}`
    if (f.min !== undefined) return `${v.label} ≥ ${f.min}${unit}`
    return `${v.label} ≤ ${f.max}${unit}`
  })
}

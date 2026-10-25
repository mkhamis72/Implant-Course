// Follow-up windows for Statistics → Explore, in days since placement. Measurements from different windows are
// never pooled: each implant gives at most one value per window (observations.ts).

export type TimepointKey = 'placement' | 'early' | 'm3' | 'm6' | 'm12' | 'm24' | 'later'
export type Window = TimepointKey | { from: number; to: number }

/** target null = the latest observation in the window. */
export const TIMEPOINTS: { key: TimepointKey; label: string; from: number; to: number | null; target: number | null }[] = [
  { key: 'placement', label: 'At placement', from: 0, to: 0, target: 0 },
  { key: 'early', label: 'Early (up to 2 months)', from: 1, to: 60, target: 30 },
  { key: 'm3', label: '3 months', from: 61, to: 135, target: 90 },
  { key: 'm6', label: '6 months', from: 136, to: 270, target: 180 },
  { key: 'm12', label: '12 months', from: 271, to: 545, target: 365 },
  { key: 'm24', label: '24 months', from: 546, to: 910, target: 730 },
  { key: 'later', label: 'Later follow-up', from: 911, to: null, target: null },
]

export function windowFor(days: number): TimepointKey {
  return TIMEPOINTS.find((t) => days >= t.from && (t.to === null || days <= t.to))?.key ?? 'later'
}

export function windowRange(w: Window): { from: number; to: number | null; target: number | null } {
  if (typeof w !== 'string') return { from: w.from, to: w.to, target: (w.from + w.to) / 2 }
  const t = TIMEPOINTS.find((p) => p.key === w)!
  return { from: t.from, to: t.to, target: t.target }
}

export function windowLabel(w: Window): string {
  return typeof w === 'string' ? TIMEPOINTS.find((t) => t.key === w)!.label : `Days ${w.from}–${w.to}`
}

const DAY = 86_400_000
/** Whole days from one ISO date to another (dates parsed as UTC, so no daylight-saving shifts). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY)
}

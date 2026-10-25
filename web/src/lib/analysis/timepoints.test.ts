import { describe, expect, it } from 'vitest'
import { daysBetween, TIMEPOINTS, windowFor, windowRange } from './timepoints'

describe('follow-up windows', () => {
  it('puts each day in one window', () => {
    expect([0, 1, 60, 61, 135, 136, 270, 271, 545, 546, 910, 911, 2000].map(windowFor))
      .toEqual(['placement', 'early', 'early', 'm3', 'm3', 'm6', 'm6', 'm12', 'm12', 'm24', 'm24', 'later', 'later'])
    expect(TIMEPOINTS.map((t) => t.target)).toEqual([0, 30, 90, 180, 365, 730, null])
  })

  it('takes a custom window with its midpoint as target', () => {
    expect(windowRange({ from: 300, to: 400 })).toEqual({ from: 300, to: 400, target: 350 })
    expect(windowRange('later')).toEqual({ from: 911, to: null, target: null })
  })

  it('counts calendar days without time zones', () => {
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1)
    expect(daysBetween('2025-03-30', '2025-03-31')).toBe(1)
    expect(daysBetween('2025-01-10', '2026-01-10')).toBe(365)
  })
})

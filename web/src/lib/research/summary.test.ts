import { describe, expect, it } from 'vitest'
import {
  complications,
  crownSummary,
  formatPct,
  icoiBreakdown,
  kaplanMeier,
  survivalAt,
  type CrownRow,
  type ImplantRow,
} from './summary'

const DAY = 30.4375

function row(over: Partial<ImplantRow> = {}): ImplantRow {
  return {
    year_1: 'survived',
    year_2: 'survived',
    latest_grade: null,
    biological_complications: 0,
    mechanical_complications: 0,
    follow_up_days: 365,
    event: false,
    event_time_unknown: false,
    ...over,
  }
}
const many = (n: number, over: Partial<ImplantRow>) => Array.from({ length: n }, () => row(over))

describe('survivalAt', () => {
  const rows = [
    ...many(88, { year_1: 'survived' }),
    ...many(2, { year_1: 'failed' }),
    ...many(41, { year_1: 'not_reached' }),
    ...many(15, { year_1: 'unknown' }),
  ]
  it('counts and computes pct', () => {
    const r = survivalAt(rows, 'year_1')
    expect(r).toMatchObject({ survived: 88, failed: 2, notReached: 41, unknown: 15, small: false })
    expect(r.pct).toBeCloseTo(97.78, 1)
  })
  it('flags small samples (M < 30)', () => {
    const r = survivalAt([...many(23, { year_1: 'survived' }), ...many(2, { year_1: 'failed' })], 'year_1')
    expect(r.small).toBe(true)
  })
  it('has null pct with no rows', () => {
    expect(survivalAt([], 'year_2')).toMatchObject({ pct: null, small: true, survived: 0 })
  })
})

describe('icoiBreakdown', () => {
  it('counts null as not_graded', () => {
    const r = icoiBreakdown([
      row({ latest_grade: 'I' }),
      row({ latest_grade: 'I' }),
      row({ latest_grade: 'IV' }),
      row({ latest_grade: 'not_assessable' }),
      row({ latest_grade: null }),
    ])
    expect(r).toEqual({ I: 2, II: 0, III: 0, IV: 1, not_assessable: 1, not_graded: 1 })
  })
})

describe('complications', () => {
  it('computes percentages of all implants', () => {
    const r = complications([
      row({ biological_complications: 2 }),
      row({ mechanical_complications: 1 }),
      row({ biological_complications: 1, mechanical_complications: 1 }),
      row(),
    ])
    expect(r).toEqual({ implants: 4, biological: 2, mechanical: 2, biologicalPct: 50, mechanicalPct: 50 })
  })
  it('handles zero rows', () => {
    expect(complications([])).toEqual({
      implants: 0, biological: 0, mechanical: 0, biologicalPct: null, mechanicalPct: null,
    })
  })
})

describe('crownSummary', () => {
  it('counts finals, remade and crowns with problems', () => {
    const c = (remade: boolean, problems: number) => ({ remade, problems }) as CrownRow
    expect(crownSummary([c(false, 0), c(true, 1), c(false, 2)])).toEqual({ finals: 3, remade: 1, problems: 2 })
  })
})

describe('kaplanMeier', () => {
  const at = (months: number, event: boolean, extra: Partial<ImplantRow> = {}) =>
    row({ follow_up_days: months * DAY, event, ...extra })

  it('steps at events and ignores censoring in the drop', () => {
    const r = kaplanMeier([at(6, true), at(9, false), at(12, true), at(24, false)])
    expect(r.points[0]).toEqual({ month: 0, survival: 1 })
    expect(r.points.find((p) => p.month === 6)?.survival).toBeCloseTo(0.75)
    // after the event at 6: 3 at risk; censor at 9 leaves 2; event at 12: 0.75 * 1/2
    expect(r.points.find((p) => p.month === 12)?.survival).toBeCloseTo(0.375)
  })
  it('applies events before censorings at tied times', () => {
    const r = kaplanMeier([at(6, true), at(6, false), at(20, false), at(20, false)])
    expect(r.points.find((p) => p.month === 6)?.survival).toBeCloseTo(0.75)
  })
  it('excludes unknown-time rows and counts them', () => {
    const r = kaplanMeier([at(6, true), at(12, false), at(3, true, { event_time_unknown: true })])
    expect(r.excludedUnknownTime).toBe(1)
    expect(r.points.find((p) => p.month === 6)?.survival).toBeCloseTo(0.5)
  })
  it('reports at-risk at 0, 12 and 24 months', () => {
    const r = kaplanMeier([at(6, true), at(13, false), at(30, false)])
    expect(r.atRisk).toEqual([
      { month: 0, n: 3 },
      { month: 12, n: 2 },
      { month: 24, n: 1 },
    ])
  })
})

describe('formatPct', () => {
  it('formats', () => {
    expect(formatPct(null)).toBe('—')
    expect(formatPct(97.777)).toBe('97.8%')
    expect(formatPct(100)).toBe('100.0%')
  })
})
